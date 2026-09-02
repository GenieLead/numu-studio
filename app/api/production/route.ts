export const maxDuration = 120;

import { and, asc, eq, inArray } from "drizzle-orm";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { getDb } from "@/db";
import { productionArtifacts, productionRuns, productionTasks, directions } from "@/db/schema";
import { analyzeMasterQc, analyzeReferenceEvidence } from "@/lib/production-ai";
import { getOpenRouterKey, openRouterHeaders, sealOpenRouterKey } from "@/lib/openrouter-session";
import { submitMediaWorkerJob } from "@/lib/media-worker-session";
import { OMNI_MODEL, OMNI_RESOLUTION, omniQuote, omniUnitCost } from "@/lib/omni-pricing";
import {
  effectiveProductionHardGates,
  guardEvidenceDossier,
  lockSafeProductionShotPlan,
} from "@/lib/production-guardrails";
import {
  imageRoute,
  motionRoute,
  revalidateApprovedImageRoute,
  type ApprovedImageRoute,
} from "@/lib/production-routing";
import {
  ensureProduction,
  publicProduction,
  refreshProduction,
  storyboardIdentityReferenceCount,
  type OwnedProduction,
} from "@/lib/production-server";
import {
  IMAGE_ASPECT_RATIO,
  IMAGE_RESOLUTION,
  MOTION_ASPECT_RATIO,
  MOTION_CLIP_SECONDS,
  MOTION_RESOLUTION,
  identityPlatePrompt,
  identityRolesForShot,
  motionPrompt,
  shotRouteContract,
  storyboardPrompt,
  type ProductionStage,
  type ReferenceEvidenceFrame,
} from "@/lib/production-studio";
import { getBucket } from "@/lib/storage";
import { streamedJsonTask } from "@/lib/streamed-json";

const MAX_EVIDENCE_FRAMES = 18;
const MAX_EVIDENCE_FRAME_BYTES = 420_000;
const IMAGE_PROVIDER_TIMEOUT_MS = 120_000;
const MOTION_SUBMISSION_TIMEOUT_MS = 20_000;
const STAGE_TRANSITION: Record<Exclude<ProductionStage, "master">, ProductionStage> = {
  evidence: "identity",
  identity: "storyboard",
  storyboard: "motion",
  motion: "voice",
  voice: "score",
  score: "conform",
  stems: "conform",
  conform: "qc",
  qc: "master",
};

function traceProduction(
  production: OwnedProduction,
  phase: string,
  detail: { previousPhase?: string | null; status?: string; providerRequestStarted?: boolean; error?: string | null } = {},
): void {
  console.info(JSON.stringify({
    event: "hayk.production.phase",
    traceId: production.run.id,
    operationId: production.run.id,
    projectId: production.run.projectId,
    directionId: production.run.directionId,
    currentPhase: phase,
    previousPhase: detail.previousPhase ?? null,
    status: detail.status ?? "processing",
    providerRequestStarted: detail.providerRequestStarted ?? false,
    error: detail.error ?? null,
  }));
}

function parseDataUrl(value: string): { mimeType: string; bytes: Uint8Array } {
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error("One evidence frame was not a supported image.");
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength > MAX_EVIDENCE_FRAME_BYTES) throw new Error("One evidence frame exceeded the local-analysis limit.");
  return { mimeType: match[1].toLowerCase(), bytes };
}

function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    const chunk = bytes.subarray(offset, Math.min(offset + size, bytes.length));
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

async function objectDataUrl(objectKey: string, mimeType: string): Promise<string> {
  const object = await getBucket().get(objectKey);
  if (!object) throw new Error("A protected visual asset is missing.");
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function metadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function approvedImageRoute(value: Record<string, unknown>): ApprovedImageRoute | null {
  const route = value.approvedImageRoute;
  if (!route || typeof route !== "object" || Array.isArray(route)) return null;
  const record = route as Record<string, unknown>;
  if (!["model", "modelName", "endpointUrl", "providerTag", "providerName"].every((key) => typeof record[key] === "string" && Boolean((record[key] as string).trim()))) return null;
  if (typeof record.unitCostUsd !== "number" || !Number.isFinite(record.unitCostUsd) || record.unitCostUsd < 0) return null;
  return record as ApprovedImageRoute;
}

function approvedImageRouteRecord(route: ApprovedImageRoute): ApprovedImageRoute {
  return {
    model: route.model,
    modelName: route.modelName,
    endpointUrl: route.endpointUrl,
    providerTag: route.providerTag,
    providerName: route.providerName,
    unitCostUsd: route.unitCostUsd,
  };
}

async function recomputeRunCost(runId: string): Promise<void> {
  const db = getDb();
  const artifacts = await db.select({ actualCostUsd: productionArtifacts.actualCostUsd })
    .from(productionArtifacts)
    .where(eq(productionArtifacts.runId, runId));
  const total = artifacts.reduce((sum, artifact) => sum + (artifact.actualCostUsd ? Number(artifact.actualCostUsd) : 0), 0);
  await db.update(productionRuns).set({
    actualCostUsd: total.toFixed(5),
    updatedAt: new Date().toISOString(),
  }).where(eq(productionRuns.id, runId));
}

async function dossierMetadata(runId: string): Promise<Record<string, unknown> | null> {
  const [dossier] = await getDb().select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, runId),
    eq(productionArtifacts.kind, "reference_dossier"),
  )).limit(1);
  return dossier?.status === "completed" ? metadata(dossier.metadataJson) : null;
}

async function createStageArtifacts(production: OwnedProduction, stage: ProductionStage): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const base = {
    ownerEmail: production.run.ownerEmail,
    projectId: production.run.projectId,
    directionId: production.run.directionId,
    runId: production.run.id,
    approvalStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };
  if (stage === "identity") {
    const rowById = new Map(production.referenceRows.map((row) => [row.id, row]));
    const bindings = production.bindings.filter((binding, index, all) =>
      ["product", "character", "location"].includes(binding.role)
      && all.findIndex((candidate) => candidate.id === binding.id) === index
      && rowById.get(binding.id)?.mimeType.startsWith("image/"),
    );
    if (!bindings.some((binding) => binding.role === "product")) throw new Error("A product authority image is required before visual production.");
    for (const [index, binding] of bindings.entries()) {
      await db.insert(productionArtifacts).values({
        ...base,
        id: crypto.randomUUID(),
        stage,
        kind: "identity_plate",
        shotId: binding.role.toUpperCase(),
        label: `${binding.role[0].toUpperCase()}${binding.role.slice(1)} identity plate`,
        status: "planned",
        orderIndex: index,
        prompt: identityPlatePrompt(production.card, binding.role as "product" | "character" | "location"),
        metadataJson: JSON.stringify({ role: binding.role, sourceReferenceIds: [binding.id], lineage: "source authority → canonical plate" }),
      }).onConflictDoNothing();
    }
    return;
  }
  if (stage === "storyboard") {
    const dossier = await dossierMetadata(production.run.id);
    for (const [shotIndex, shot] of lockSafeProductionShotPlan(production.card).entries()) {
      for (const [frameIndex, frameType] of (["start", "end"] as const).entries()) {
        await db.insert(productionArtifacts).values({
          ...base,
          id: crypto.randomUUID(),
          stage,
          kind: frameType === "start" ? "keyframe_start" : "keyframe_end",
          shotId: shot.id,
          label: `${shot.id} ${frameType === "start" ? "first frame" : "landing frame"}`,
          status: "planned",
          orderIndex: shotIndex * 2 + frameIndex,
          prompt: storyboardPrompt(production.card, shot, frameType, dossier),
          metadataJson: JSON.stringify({
            frameType,
            shotTitle: shot.title,
            shotTime: shot.time,
            identityRoles: identityRolesForShot(shot),
            lineage: "canonical identity plates + lock-safe reference grammar → approved keyframe",
            guardrailVersion: "production-locks-v4",
          }),
        }).onConflictDoNothing();
      }
    }
    return;
  }
  if (stage === "motion") {
    const dossier = await dossierMetadata(production.run.id);
    for (const [index, shot] of lockSafeProductionShotPlan(production.card).entries()) {
      const routeContract = shotRouteContract(shot, production.bindings);
      await db.insert(productionArtifacts).values({
        ...base,
        id: crypto.randomUUID(),
        stage,
        kind: "shot_video",
        shotId: shot.id,
        label: `${shot.id} ${shot.title}`,
        status: "planned",
        orderIndex: index,
        prompt: motionPrompt(production.card, shot, dossier),
        metadataJson: JSON.stringify({
          shotTitle: shot.title,
          shotTime: shot.time,
          deliverySeconds: production.card.deliverySeconds,
          sourceSeconds: MOTION_CLIP_SECONDS,
          routeContract,
          lineage: routeContract.mode === "source_edit"
            ? "protected source performance → OpenRouter multimodal edit → original-audio conform"
            : "approved first + landing frames → Seedance 2.5 source shot",
        }),
      }).onConflictDoNothing();
    }
    return;
  }
  if (stage === "voice") {
    const script = "عسلامة. تَوّا نوريك كيفاش العطر هذا يخلّي حضورك يتْحَسّ من أوّل لحظة. ريحتو دافية، ثابتة ومميّزة.";
    await db.insert(productionArtifacts).values({
      ...base, id: crypto.randomUUID(), stage, kind: "voice_consent", shotId: "CONSENT",
      label: "Voice owner consent", status: "planned", orderIndex: 0,
      metadataJson: JSON.stringify({ required: true, scopes: ["audition", "voice_conversion", "lip_sync"], revocable: true, lineage: "voice owner + explicit scope → auditable consent" }),
    }).onConflictDoNothing();
    for (const [index, profile] of ["restrained founder", "warm cinematic", "authoritative minimal"].entries()) {
      await db.insert(productionArtifacts).values({
        ...base, id: crypto.randomUUID(), stage, kind: "voice_audition", shotId: `VOICE-${index + 1}`,
        label: `Derja audition ${index + 1} · ${profile}`, status: "planned", orderIndex: index + 1,
        prompt: script, model: "fish-audio/s2.1-pro",
        metadataJson: JSON.stringify({ dialect: "ar-TN", identicalScript: script, profile, nativeReviewRequired: true, consentRequired: true, lineage: "consented sample + identical Derja script → blind native audition" }),
      }).onConflictDoNothing();
    }
    await db.insert(productionArtifacts).values({
      ...base, id: crypto.randomUUID(), stage, kind: "dialogue_master", shotId: "DIALOGUE",
      label: "Approved dialogue performance", status: "planned", orderIndex: 4,
      metadataJson: JSON.stringify({ requiresApprovedAudition: true, lineage: "native-approved audition → production dialogue" }),
    }).onConflictDoNothing();
    await db.insert(productionArtifacts).values({
      ...base, id: crypto.randomUUID(), stage, kind: "lip_sync", shotId: "LIPSYNC",
      label: "Performance-preserving lip-sync pass", status: "planned", orderIndex: 5,
      metadataJson: JSON.stringify({ requiresDialogueMaster: true, requiresMediaWorker: true, preserve: ["face identity", "body performance", "camera", "source audio timing"], lineage: "approved dialogue + selected face shots → production lip-sync" }),
    }).onConflictDoNothing();
    return;
  }
  if (stage === "score") {
    await db.insert(productionArtifacts).values({
      ...base, id: crypto.randomUUID(), stage, kind: "score_master", shotId: "SCORE",
      label: "Original Lyria score", status: "planned", orderIndex: 0, model: "google/lyria-3-clip-preview",
      prompt: `Create an original instrumental score for “${production.card.title}”. Duration ${production.card.deliverySeconds} seconds. No vocals, no recognizable melody, no reference-audio copying. Follow the approved emotional arc and leave transient space for dialogue, Foley and product detail.`,
      estimatedCostUsd: "0.04",
      metadataJson: JSON.stringify({ separateApproval: true, target: "48kHz stereo", noVocals: true, noReferenceMelody: true, lineage: "approved sound direction → original Lyria score" }),
    }).onConflictDoNothing();
    return;
  }
  if (stage === "stems") {
    for (const [index, kind] of ["dialogue", "music", "ambience", "foley", "effects"].entries()) {
      await db.insert(productionArtifacts).values({
        ...base, id: crypto.randomUUID(), stage, kind: `${kind}_stem`, shotId: kind.toUpperCase(),
        label: `${kind[0].toUpperCase()}${kind.slice(1)} stem · 48kHz WAV`, status: "planned", orderIndex: index,
        metadataJson: JSON.stringify({ format: "wav", sampleRate: 48000, channels: 2, isolated: true, requiresMediaWorker: true, lineage: `approved sources → isolated ${kind} stem` }),
      }).onConflictDoNothing();
    }
    return;
  }
  if (stage === "conform") {
    await db.insert(productionArtifacts).values({
      ...base,
      id: crypto.randomUUID(),
      stage, kind: "review_cut",
      shotId: "MASTER",
      label: `${production.card.deliverySeconds}s director cut`,
      status: "planned",
      orderIndex: 0,
      metadataJson: JSON.stringify({
        editDecisionList: lockSafeProductionShotPlan(production.card).map((shot) => ({ id: shot.id, time: shot.time })),
        method: "browser canvas + MediaRecorder deterministic test-video assembly",
        requirements: ["preloaded source shots", "locked EDL", "synchronized source audio", "optional approved score mix", "visible QC before download"],
        requiresMediaWorker: false,
        professionalMasterAvailableWithWorker: true,
      }),
    }).onConflictDoNothing();
    return;
  }
  if (stage === "qc") {
    await db.insert(productionArtifacts).values({
      ...base,
      id: crypto.randomUUID(),
      stage,
      kind: "qc_report",
      shotId: "QC",
      label: "Multimodal continuity report",
      status: "planned",
      orderIndex: 0,
      metadataJson: JSON.stringify({ gates: effectiveProductionHardGates(production.card), lineage: "assembled master + identity ground truth → QC" }),
    }).onConflictDoNothing();
  }
}

async function approveCurrentStage(production: OwnedProduction, stage: ProductionStage): Promise<OwnedProduction> {
  if (production.run.currentStage !== stage) throw new Error(`The current production gate is ${production.run.currentStage}, not ${stage}.`);
  if (stage === "master") return production;
  const db = getDb();
  const artifacts = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.stage, stage),
  ));
  const required = artifacts.filter((artifact) => artifact.kind !== "source_asset");
  if (!required.length || required.some((artifact) => artifact.status !== "completed")) {
    throw new Error("Complete and inspect every required artifact before approving this gate.");
  }
  const now = new Date().toISOString();
  if (stage === "evidence") {
    const dossier = artifacts.find((artifact) => artifact.kind === "reference_dossier");
    if (dossier) {
      await db.update(productionArtifacts).set({
        metadataJson: JSON.stringify(guardEvidenceDossier(production.card, metadata(dossier.metadataJson))),
        updatedAt: now,
      }).where(eq(productionArtifacts.id, dossier.id));
    }
  }
  await db.update(productionArtifacts).set({ approvalStatus: "approved", approvedAt: now, updatedAt: now }).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.stage, stage),
  ));
  const next = STAGE_TRANSITION[stage];
  await createStageArtifacts(production, next);
  await db.update(productionRuns).set({
    currentStage: next,
    status: next === "identity" || next === "storyboard" || next === "motion" ? "awaiting_budget" : next === "voice" ? "awaiting_voice_consent" : next === "score" ? "awaiting_score_approval" : next === "stems" ? "awaiting_stems" : next === "conform" ? "awaiting_media_worker" : next === "qc" ? "awaiting_qc" : "master_ready",
    estimatedCostUsd: null,
    approvedCostUsd: null,
    error: null,
    updatedAt: now,
  }).where(eq(productionRuns.id, production.run.id));
  return refreshProduction(production);
}

async function skipVoice(production: OwnedProduction): Promise<OwnedProduction> {
  if (production.run.currentStage !== "voice") throw new Error("The voice decision is no longer open.");
  const now = new Date().toISOString();
  const artifacts = await getDb().select().from(productionArtifacts).where(and(eq(productionArtifacts.runId, production.run.id), eq(productionArtifacts.stage, "voice")));
  for (const artifact of artifacts) {
    await getDb().update(productionArtifacts).set({
      status: "completed", approvalStatus: "approved", approvedAt: now, error: null,
      metadataJson: JSON.stringify({ ...metadata(artifact.metadataJson), deliberatelySkipped: true, decision: "No dialogue or voiceover in this film" }), updatedAt: now,
    }).where(eq(productionArtifacts.id, artifact.id));
  }
  await createStageArtifacts(production, "score");
  await getDb().update(productionRuns).set({ currentStage: "score", status: "awaiting_score_approval", estimatedCostUsd: null, approvedCostUsd: null, error: null, updatedAt: now }).where(eq(productionRuns.id, production.run.id));
  return refreshProduction(production);
}

async function skipScore(production: OwnedProduction): Promise<OwnedProduction> {
  if (production.run.currentStage !== "score") throw new Error("The score decision is no longer open.");
  const db = getDb();
  const now = new Date().toISOString();
  const artifacts = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.stage, "score"),
  ));
  for (const artifact of artifacts) {
    if (artifact.status === "working") throw new Error("The score job is already running. It cannot be silently discarded.");
    await db.update(productionArtifacts).set({
      status: "completed",
      approvalStatus: "approved",
      approvedAt: now,
      actualCostUsd: artifact.actualCostUsd ?? "0",
      error: null,
      metadataJson: JSON.stringify({
        ...metadata(artifact.metadataJson),
        deliberatelySkipped: true,
        decision: "Use only the synchronized original audio embedded in the approved source shots",
      }),
      updatedAt: now,
    }).where(eq(productionArtifacts.id, artifact.id));
  }
  await createStageArtifacts(production, "conform");
  await db.update(productionRuns).set({
    currentStage: "conform",
    status: "awaiting_review_assembly",
    estimatedCostUsd: null,
    approvedCostUsd: null,
    error: null,
    updatedAt: now,
  }).where(eq(productionRuns.id, production.run.id));
  return refreshProduction(production);
}

async function approveBudget(production: OwnedProduction, stage: ProductionStage, approvedMaxCostUsd: number): Promise<OwnedProduction> {
  if (production.run.currentStage !== stage || !["identity", "storyboard", "motion", "score"].includes(stage)) {
    throw new Error("This production stage has no paid route to authorize.");
  }
  if (stage === "score") {
    if (Math.abs(approvedMaxCostUsd - 0.04) > 0.0001) throw new Error("The Lyria 3 Clip ceiling is $0.04. Review it before spending.");
    const now = new Date().toISOString();
    await getDb().update(productionRuns).set({ estimatedCostUsd: "0.04", approvedCostUsd: "0.04", status: "stage_authorized", error: null, updatedAt: now }).where(eq(productionRuns.id, production.run.id));
    return refreshProduction(production);
  }
  const artifacts = await getDb().select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.stage, stage),
  ));
  const remaining = artifacts.filter((artifact) => artifact.status !== "completed");
  if (!remaining.length) throw new Error("This stage is already complete.");
  const sourceEdit = stage === "motion" && remaining.some((artifact) => metadata(artifact.metadataJson).routeContract
    && (metadata(artifact.metadataJson).routeContract as Record<string, unknown>).mode === "source_edit");
  if (sourceEdit) {
    const quote = omniQuote(remaining.length, MOTION_CLIP_SECONDS);
    if (Math.abs(approvedMaxCostUsd - quote.maxCostUsd) > 0.0001) throw new Error(`The Gemini Omni ceiling is now $${quote.maxCostUsd.toFixed(2)}. Review it before spending.`);
    const unitCost = omniUnitCost(MOTION_CLIP_SECONDS);
    const now = new Date().toISOString();
    for (const artifact of remaining) await getDb().update(productionArtifacts).set({ model: OMNI_MODEL, estimatedCostUsd: unitCost.toFixed(5), updatedAt: now }).where(eq(productionArtifacts.id, artifact.id));
    await getDb().update(productionRuns).set({ estimatedCostUsd: quote.estimatedCostUsd.toFixed(5), approvedCostUsd: quote.maxCostUsd.toFixed(2), status: "stage_authorized", error: null, updatedAt: now }).where(eq(productionRuns.id, production.run.id));
    return refreshProduction(production);
  }
  const apiKey = await getOpenRouterKey();
  if (!apiKey) throw new Error("Reconnect OpenRouter before approving paid production.");
  const storyboardReferenceCount = stage === "storyboard"
    ? await storyboardIdentityReferenceCount(production.run.id)
    : null;
  if (stage === "storyboard" && !storyboardReferenceCount) {
    throw new Error("The approved canonical identity plates are missing. Nothing was spent.");
  }
  const route = stage === "motion"
    ? await motionRoute(apiKey, remaining.length)
    : await imageRoute(
        apiKey,
        stage as "identity" | "storyboard",
        remaining.length,
        stage === "identity" ? 1 : storyboardReferenceCount!,
      );
  if (Math.abs(approvedMaxCostUsd - route.quote.maxCostUsd) > 0.0001) {
    throw new Error(`The live ceiling is now $${route.quote.maxCostUsd.toFixed(2)}. Review it before spending.`);
  }
  if (route.quote.fundingSufficient === false) {
    throw new Error(`This stage needs up to $${route.quote.maxCostUsd.toFixed(2)}, but the connected key has $${(route.quote.remainingUsd ?? 0).toFixed(2)} remaining.`);
  }
  const perArtifact = route.unitCostUsd;
  const now = new Date().toISOString();
  for (const artifact of remaining) {
    const artifactMetadata = metadata(artifact.metadataJson);
    await getDb().update(productionArtifacts).set({
      model: route.model,
      estimatedCostUsd: perArtifact.toFixed(5),
      metadataJson: "endpointUrl" in route
        ? JSON.stringify({ ...artifactMetadata, approvedImageRoute: approvedImageRouteRecord(route) })
        : artifact.metadataJson,
      updatedAt: now,
    }).where(eq(productionArtifacts.id, artifact.id));
  }
  await getDb().update(productionRuns).set({
    estimatedCostUsd: route.quote.estimatedCostUsd.toFixed(5),
    approvedCostUsd: route.quote.maxCostUsd.toFixed(2),
    status: "stage_authorized",
    error: null,
    updatedAt: now,
  }).where(eq(productionRuns.id, production.run.id));
  return refreshProduction(production);
}

async function submitScore(production: OwnedProduction, origin: string): Promise<OwnedProduction> {
  if (production.run.currentStage !== "score" || production.run.approvedCostUsd !== "0.04") throw new Error("Approve the $0.04 Lyria score gate first.");
  const [artifact] = await getDb().select().from(productionArtifacts).where(and(eq(productionArtifacts.runId, production.run.id), eq(productionArtifacts.stage, "score"), eq(productionArtifacts.kind, "score_master"))).limit(1);
  if (!artifact || artifact.status !== "planned") throw new Error("The Lyria score slot is not ready.");
  const token = await sealOpenRouterKey(JSON.stringify({ artifactId: artifact.id, purpose: "worker_output", expires: Date.now() + 60 * 60 * 1000, mimeType: "audio/wav" }));
  const outputUploadUrl = `${origin}/api/media-worker/artifacts/${encodeURIComponent(artifact.id)}?token=${encodeURIComponent(token)}`;
  const now = new Date().toISOString();
  await getDb().update(productionArtifacts).set({ status: "working", model: "lyria-3-clip-preview", error: null, updatedAt: now }).where(eq(productionArtifacts.id, artifact.id));
  try {
    const job = await submitMediaWorkerJob({ operation: "lyria_generate", model: "lyria-3-clip-preview", prompt: artifact.prompt, output_upload_url: outputUploadUrl });
    await getDb().insert(productionTasks).values({
      id: crypto.randomUUID(), ownerEmail: production.run.ownerEmail, projectId: production.run.projectId, directionId: production.run.directionId,
      runId: production.run.id, artifactId: artifact.id, providerJobId: job.id, pollingUrl: "media-worker", status: job.status,
      model: "google/lyria-3-clip-preview", maxCostUsd: "0.04", requestJson: JSON.stringify({ operation: "lyria_generate", prompt: artifact.prompt, output: "private artifact slot" }),
      responseJson: JSON.stringify(job), createdAt: now, updatedAt: now,
    });
    await getDb().update(productionRuns).set({ status: "generating_score", error: null, updatedAt: now }).where(eq(productionRuns.id, production.run.id));
    return refreshProduction(production);
  } catch (error) {
    const message = `${error instanceof Error ? error.message : "Lyria score submission failed"} No retry was made.`;
    await getDb().update(productionArtifacts).set({ status: "failed", error: message, updatedAt: new Date().toISOString() }).where(eq(productionArtifacts.id, artifact.id));
    await getDb().update(productionRuns).set({ status: "stage_failed", error: message, updatedAt: new Date().toISOString() }).where(eq(productionRuns.id, production.run.id));
    throw new Error(message);
  }
}

async function imageInputsFor(production: OwnedProduction, artifact: typeof productionArtifacts.$inferSelect): Promise<Array<{ type: "image_url"; image_url: { url: string } }>> {
  const inputs: Array<{ type: "image_url"; image_url: { url: string } }> = [];
  if (artifact.stage === "identity") {
    const ids = Array.isArray(metadata(artifact.metadataJson).sourceReferenceIds)
      ? metadata(artifact.metadataJson).sourceReferenceIds as string[]
      : [];
    for (const row of production.referenceRows.filter((candidate) => ids.includes(candidate.id)).slice(0, 2)) {
      inputs.push({ type: "image_url", image_url: { url: await objectDataUrl(row.objectKey, row.mimeType) } });
    }
    return inputs;
  }
  const identityPlates = await getDb().select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.stage, "identity"),
    eq(productionArtifacts.status, "completed"),
  )).orderBy(asc(productionArtifacts.orderIndex));
  const requestedRoles = Array.isArray(metadata(artifact.metadataJson).identityRoles)
    ? new Set((metadata(artifact.metadataJson).identityRoles as unknown[]).filter((role): role is string => typeof role === "string"))
    : null;
  const selected = identityPlates.filter((item) => {
    if (!item.objectKey || !item.mimeType) return false;
    if (!requestedRoles?.size) return true;
    const role = metadata(item.metadataJson).role;
    return typeof role === "string" && requestedRoles.has(role);
  }).slice(0, 3);
  for (const plate of selected) {
    inputs.push({ type: "image_url", image_url: { url: await objectDataUrl(plate.objectKey!, plate.mimeType!) } });
  }
  return inputs;
}

async function generateNextImage(production: OwnedProduction, apiKey: string): Promise<OwnedProduction> {
  const stage = production.run.currentStage as ProductionStage;
  if (!["identity", "storyboard"].includes(stage) || !production.run.approvedCostUsd) throw new Error("Approve this image stage's live ceiling first.");
  if (!apiKey) throw new Error("Reconnect OpenRouter before image production.");
  const db = getDb();
  const artifacts = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.stage, stage),
  )).orderBy(asc(productionArtifacts.orderIndex));
  if (artifacts.some((artifact) => artifact.status === "working")) {
    throw new Error("An image in this gate is already being generated. No duplicate request was sent.");
  }
  const next = artifacts.find((artifact) => artifact.status === "planned");
  if (!next) return production;
  const remaining = artifacts.filter((artifact) => artifact.status === "planned").length;
  const inputReferences = await imageInputsFor(production, next);
  if (!inputReferences.length) throw new Error("The authority images for this production frame are missing.");
  const storedRoute = approvedImageRoute(metadata(next.metadataJson));
  const route = storedRoute
    ? await revalidateApprovedImageRoute(apiKey, storedRoute, inputReferences.length)
    : await imageRoute(apiKey, stage as "identity" | "storyboard", remaining, inputReferences.length);
  if (route.unitCostUsd > Number(next.estimatedCostUsd ?? 0) + 0.00001) {
    throw new Error("The live image route rose above the approved stage ceiling. Nothing new was spent.");
  }
  if (!storedRoute && "endpointUrl" in route) {
    const routeRecord = approvedImageRouteRecord(route);
    const migratedAt = new Date().toISOString();
    for (const artifact of artifacts.filter((candidate) => candidate.status === "planned")) {
      await db.update(productionArtifacts).set({
        metadataJson: JSON.stringify({ ...metadata(artifact.metadataJson), approvedImageRoute: routeRecord }),
        updatedAt: migratedAt,
      }).where(and(eq(productionArtifacts.id, artifact.id), eq(productionArtifacts.status, "planned")));
    }
  }
  const now = new Date().toISOString();
  const claimed = await db.update(productionArtifacts)
    .set({ status: "working", model: route.model, error: null, updatedAt: now })
    .where(and(eq(productionArtifacts.id, next.id), eq(productionArtifacts.status, "planned")))
    .returning({ id: productionArtifacts.id });
  if (!claimed.length) {
    throw new Error("This image was already claimed by another request. No duplicate request was sent.");
  }
  await db.update(productionRuns).set({ status: "generating_images", updatedAt: now }).where(eq(productionRuns.id, production.run.id));
  const providerRequest = {
    model: route!.model,
    prompt: next.prompt,
    resolution: IMAGE_RESOLUTION,
    aspect_ratio: IMAGE_ASPECT_RATIO,
    n: 1,
    input_references: inputReferences,
  };
  let response: Response;
  let responseText: string;
  try {
    response = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify(providerRequest),
      signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS),
    });
    responseText = await response.text();
  } catch (caught) {
    const timedOut = caught instanceof Error && ["TimeoutError", "AbortError"].includes(caught.name);
    const error = timedOut
      ? "The image provider did not return a complete image within 65 seconds. The request was stopped before the site runtime could strand this artifact. OpenRouter bills image requests only when a final image completes; HAYK recorded no completed result. No automatic retry was made."
      : "The image provider connection ended before HAYK received a complete image. HAYK recorded no completed result. No automatic retry was made.";
    const interruptedAt = new Date().toISOString();
    await db.update(productionArtifacts).set({
      status: "failed",
      error,
      metadataJson: JSON.stringify({
        ...metadata(next.metadataJson),
        interruptedRequest: true,
        retryUsesExistingApproval: true,
        interruptionKind: timedOut ? "provider_timeout" : "provider_connection_ended",
        interruptedAt,
      }),
      updatedAt: interruptedAt,
    }).where(eq(productionArtifacts.id, next.id));
    await db.update(productionRuns).set({ status: "stage_failed", error, updatedAt: interruptedAt }).where(eq(productionRuns.id, production.run.id));
    throw new Error(error);
  }
  let payload: { data?: Array<{ b64_json?: string; media_type?: string }>; usage?: { cost?: number }; error?: string | { message?: string } } = {};
  try { payload = JSON.parse(responseText) as typeof payload; } catch { payload = {}; }
  const image = payload.data?.[0];
  if (!response.ok || !image?.b64_json) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    const error = `${message || `Image generation failed (${response.status})`}. No retry was made.`;
    await db.update(productionArtifacts).set({ status: "failed", error, updatedAt: new Date().toISOString() }).where(eq(productionArtifacts.id, next.id));
    await db.update(productionRuns).set({ status: "stage_failed", error, updatedAt: new Date().toISOString() }).where(eq(productionRuns.id, production.run.id));
    throw new Error(error);
  }
  const bytes = Uint8Array.from(atob(image.b64_json), (character) => character.charCodeAt(0));
  const mimeType = image.media_type?.startsWith("image/") ? image.media_type : "image/png";
  const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  const objectKey = `production/${production.run.ownerEmail}/${production.run.id}/${stage}/${next.id}.${extension}`;
  const blobResult = await getBucket().put(objectKey, bytes, { httpMetadata: { contentType: mimeType } }) as { url: string } | undefined;
  const storedObjectKey = blobResult?.url ?? objectKey;
  const actualCost = typeof payload.usage?.cost === "number" ? payload.usage.cost : route.unitCostUsd;
  const completedAt = new Date().toISOString();
  await db.update(productionArtifacts).set({
    status: "completed",
    objectKey: storedObjectKey,
    mimeType,
    model: route.model,
    actualCostUsd: actualCost.toFixed(5),
    metadataJson: JSON.stringify({
      ...metadata(next.metadataJson),
      provider: route.providerName,
      inputReferenceCount: inputReferences.length,
      generatedAt: completedAt,
    }),
    updatedAt: completedAt,
  }).where(eq(productionArtifacts.id, next.id));
  const unfinished = artifacts.filter((artifact) => artifact.id !== next.id && artifact.status !== "completed").length;
  await db.update(productionRuns).set({
    status: unfinished ? "generating_images" : "stage_ready",
    error: null,
    updatedAt: completedAt,
  }).where(eq(productionRuns.id, production.run.id));
  await recomputeRunCost(production.run.id);
  return refreshProduction(production);
}

async function submitNextMotion(production: OwnedProduction, origin: string): Promise<OwnedProduction> {
  if (production.run.currentStage !== "motion" || !production.run.approvedCostUsd) throw new Error("Approve the shot-level Seedance ceiling first.");
  const db = getDb();
  const motionArtifacts = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.stage, "motion"),
  )).orderBy(asc(productionArtifacts.orderIndex));
  const next = motionArtifacts.find((artifact) => artifact.status === "planned");
  if (!next?.shotId) return production;
  const nextMetadata = metadata(next.metadataJson);
  const routeContract = nextMetadata.routeContract && typeof nextMetadata.routeContract === "object"
    ? nextMetadata.routeContract as Record<string, unknown>
    : null;
  const isSourceEdit = routeContract?.mode === "source_edit";
  const apiKey = isSourceEdit ? null : await getOpenRouterKey();
  if (!isSourceEdit && !apiKey) throw new Error("Reconnect OpenRouter before Seedance motion production.");
  const route = isSourceEdit ? null : await motionRoute(apiKey!, motionArtifacts.filter((artifact) => artifact.status === "planned").length);
  const unitCost = isSourceEdit ? omniUnitCost(MOTION_CLIP_SECONDS) : route!.unitCostUsd;
  if (unitCost > Number(next.estimatedCostUsd ?? 0) + 0.00001) {
    throw new Error("The live Seedance route rose above the approved stage ceiling. Nothing new was spent.");
  }
  const frames = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.stage, "storyboard"),
    eq(productionArtifacts.shotId, next.shotId),
  )).orderBy(asc(productionArtifacts.orderIndex));
  const first = frames.find((artifact) => artifact.kind === "keyframe_start" && artifact.objectKey && artifact.mimeType);
  const last = frames.find((artifact) => artifact.kind === "keyframe_end" && artifact.objectKey && artifact.mimeType);
  const sourceReferenceId = typeof routeContract?.sourceReferenceId === "string" ? routeContract.sourceReferenceId : null;
  const source = sourceReferenceId ? production.referenceRows.find((row) => row.id === sourceReferenceId) : null;
  if (isSourceEdit && (!source || !source.mimeType.startsWith("video/"))) throw new Error(`The protected source video for ${next.shotId} is missing.`);
  if (!isSourceEdit && (!first?.objectKey || !first.mimeType || !last?.objectKey || !last.mimeType)) throw new Error(`Approved first and landing frames for ${next.shotId} are missing.`);
  if (isSourceEdit && source) {
    const sourceToken = await sealOpenRouterKey(JSON.stringify({ referenceId: source.id, ownerEmail: production.run.ownerEmail, expires: Date.now() + 60 * 60 * 1000 }));
    const outputToken = await sealOpenRouterKey(JSON.stringify({ artifactId: next.id, purpose: "worker_output", expires: Date.now() + 60 * 60 * 1000, mimeType: "video/mp4" }));
    const inputUrl = `${origin}/api/media-worker/sources/${encodeURIComponent(source.id)}?token=${encodeURIComponent(sourceToken)}`;
    const outputUploadUrl = `${origin}/api/media-worker/artifacts/${encodeURIComponent(next.id)}?token=${encodeURIComponent(outputToken)}`;
    const prompt = `${next.prompt}\nEDIT CONTRACT: Preserve the source face, body, performance, timing, framing and camera motion. Change only the explicitly requested visual layers. Do not add dialogue. Preserve identity and temporal continuity; the original audio is conformed separately.`;
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const claimed = await db.update(productionArtifacts).set({ status: "working", model: OMNI_MODEL, error: null, updatedAt: now })
      .where(and(eq(productionArtifacts.id, next.id), eq(productionArtifacts.status, "planned")))
      .returning({ id: productionArtifacts.id });
    if (!claimed.length) throw new Error("This source shot was already claimed. No duplicate request was sent.");
    try {
      const job = await submitMediaWorkerJob({ operation: "omni_edit", model: OMNI_MODEL, input_url: inputUrl, input_mime: source.mimeType, prompt, output_upload_url: outputUploadUrl, resolution: OMNI_RESOLUTION });
      await db.insert(productionTasks).values({ id: taskId, ownerEmail: production.run.ownerEmail, projectId: production.run.projectId, directionId: production.run.directionId, runId: production.run.id, artifactId: next.id, providerJobId: job.id, pollingUrl: "media-worker", status: job.status, model: `google/${OMNI_MODEL}`, maxCostUsd: unitCost.toFixed(5), requestJson: JSON.stringify({ operation: "omni_edit", model: OMNI_MODEL, input: "private protected source", output: "private artifact slot", resolution: OMNI_RESOLUTION, prompt }), responseJson: JSON.stringify(job), createdAt: now, updatedAt: now });
      await db.update(productionRuns).set({ status: "generating_motion", error: null, updatedAt: now }).where(eq(productionRuns.id, production.run.id));
      return refreshProduction(production);
    } catch (error) {
      const message = `${error instanceof Error ? error.message : "Gemini Omni source edit failed"} No retry was made.`;
      await db.update(productionArtifacts).set({ status: "failed", error: message, updatedAt: new Date().toISOString() }).where(eq(productionArtifacts.id, next.id));
      await db.update(productionRuns).set({ status: "stage_failed", error: message, updatedAt: new Date().toISOString() }).where(eq(productionRuns.id, production.run.id));
      throw new Error(message);
    }
  }
  const providerFrameUrl = async (artifactId: string) => {
    const token = await sealOpenRouterKey(JSON.stringify({
      artifactId,
      purpose: "provider_input",
      expires: Date.now() + 60 * 60 * 1000,
    }));
    return `${origin}/api/media-worker/artifacts/${encodeURIComponent(artifactId)}?token=${encodeURIComponent(token)}`;
  };
  const frameImages = !isSourceEdit && first?.objectKey && first.mimeType && last?.objectKey && last.mimeType ? [
    { type: "image_url", image_url: { url: await providerFrameUrl(first.id) }, frame_type: "first_frame" },
    { type: "image_url", image_url: { url: await providerFrameUrl(last.id) }, frame_type: "last_frame" },
  ] : undefined;
  const inputReferences = isSourceEdit && source ? [
    { type: "video_url", video_url: { url: await objectDataUrl(source.objectKey, source.mimeType) } },
  ] : undefined;
  const providerRequest = {
    model: route!.model,
    prompt: isSourceEdit ? `${next.prompt}\nEDIT CONTRACT: Preserve the source face, body, performance, timing, framing and camera motion. Change only the explicitly requested visual layers. Do not add dialogue. The original audio is conformed separately.` : next.prompt,
    duration: MOTION_CLIP_SECONDS,
    resolution: MOTION_RESOLUTION,
    aspect_ratio: MOTION_ASPECT_RATIO,
    generate_audio: !isSourceEdit,
    ...(frameImages ? { frame_images: frameImages } : {}),
    ...(inputReferences ? { input_references: inputReferences } : {}),
  };
  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();
  const claimed = await db.update(productionArtifacts).set({ status: "working", model: route!.model, error: null, updatedAt: now })
    .where(and(eq(productionArtifacts.id, next.id), eq(productionArtifacts.status, "planned")))
    .returning({ id: productionArtifacts.id });
  if (!claimed.length) throw new Error("This source shot was already claimed. No duplicate request was sent.");
  await db.insert(productionTasks).values({
    id: taskId,
    ownerEmail: production.run.ownerEmail,
    projectId: production.run.projectId,
    directionId: production.run.directionId,
    runId: production.run.id,
    artifactId: next.id,
    providerJobId: "pending",
    pollingUrl: "pending",
    status: "authorizing",
    model: route.model,
    maxCostUsd: route!.unitCostUsd.toFixed(5),
    requestJson: JSON.stringify({ ...providerRequest, ...(frameImages ? { frame_images: [{ frame_type: "first_frame", private: true }, { frame_type: "last_frame", private: true }] } : {}), ...(inputReferences ? { input_references: [{ type: "video_url", private: true }] } : {}) }),
    responseJson: "{}",
    createdAt: now,
    updatedAt: now,
  });
  await db.update(productionRuns).set({ status: "generating_motion", error: null, updatedAt: now }).where(eq(productionRuns.id, production.run.id));
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/videos", {
      method: "POST",
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify(providerRequest),
      signal: AbortSignal.timeout(MOTION_SUBMISSION_TIMEOUT_MS),
    });
  } catch (caught) {
    const timedOut = caught instanceof Error && ["TimeoutError", "AbortError"].includes(caught.name);
    const error = timedOut
      ? `${route!.modelName} did not return a job ID within 20 seconds. The submission state is unknown, so HAYK will not retry it automatically. Check OpenRouter activity before preparing a manual retry.`
      : `${route!.modelName} could not be reached. No retry was made.`;
    await db.update(productionTasks).set({ status: "failed", error, updatedAt: new Date().toISOString() }).where(eq(productionTasks.id, taskId));
    await db.update(productionArtifacts).set({ status: "failed", error, updatedAt: new Date().toISOString() }).where(eq(productionArtifacts.id, next.id));
    await db.update(productionRuns).set({ status: "stage_failed", error, updatedAt: new Date().toISOString() }).where(eq(productionRuns.id, production.run.id));
    throw new Error(error);
  }
  const responseText = await response.text();
  let payload: { id?: string; polling_url?: string; status?: string; error?: string | { message?: string } } = {};
  try { payload = JSON.parse(responseText) as typeof payload; } catch { payload = {}; }
  if (!response.ok || !payload.id || !payload.polling_url) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    const error = `${message || `${route!.modelName} submission failed (${response.status})`}. No retry was made.`;
    await db.update(productionTasks).set({ status: "failed", error, responseJson: JSON.stringify(payload), updatedAt: new Date().toISOString() }).where(eq(productionTasks.id, taskId));
    await db.update(productionArtifacts).set({ status: "failed", error, updatedAt: new Date().toISOString() }).where(eq(productionArtifacts.id, next.id));
    await db.update(productionRuns).set({ status: "stage_failed", error, updatedAt: new Date().toISOString() }).where(eq(productionRuns.id, production.run.id));
    throw new Error(error);
  }
  await db.update(productionTasks).set({
    providerJobId: payload.id,
    pollingUrl: payload.polling_url,
    status: payload.status ?? "pending",
    responseJson: JSON.stringify(payload),
    updatedAt: new Date().toISOString(),
  }).where(eq(productionTasks.id, taskId));
  return refreshProduction(production);
}

async function ingestEvidence(production: OwnedProduction, frames: ReferenceEvidenceFrame[]): Promise<OwnedProduction> {
  if (production.run.currentStage !== "evidence") throw new Error("Reference evidence is already protected for this production run.");
  traceProduction(production, "importing_reference_evidence", { previousPhase: production.run.status });
  const bounded = frames.slice(0, MAX_EVIDENCE_FRAMES);
  if (!bounded.length && production.bindings.some((binding) => ["style", "motion", "raw", "patch"].includes(binding.role))) {
    throw new Error("No reference-video frames reached the evidence room.");
  }
  const db = getDb();
  const previous = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.kind, "reference_frame"),
  ));
  await Promise.all(previous.flatMap((artifact) => artifact.objectKey ? [getBucket().delete(artifact.objectKey)] : []));
  await db.delete(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.kind, "reference_frame"),
  ));
  const now = new Date().toISOString();
  for (const [index, frame] of bounded.entries()) {
    const parsed = parseDataUrl(frame.dataUrl);
    const id = crypto.randomUUID();
    const extension = parsed.mimeType.includes("png") ? "png" : parsed.mimeType.includes("webp") ? "webp" : "jpg";
    const objectKey = `production/${production.run.ownerEmail}/${production.run.id}/evidence/${id}.${extension}`;
    const blobResult = await getBucket().put(objectKey, parsed.bytes, { httpMetadata: { contentType: parsed.mimeType } }) as { url: string } | undefined;
    const storedObjectKey = blobResult?.url ?? objectKey;
    await db.insert(productionArtifacts).values({
      id,
      ownerEmail: production.run.ownerEmail,
      projectId: production.run.projectId,
      directionId: production.run.directionId,
      runId: production.run.id,
      stage: "evidence",
      kind: "reference_frame",
      shotId: frame.sourceId,
      label: `${frame.atSeconds.toFixed(1)}s ${frame.sampleKind === "deep" ? "cadence" : "global"} sample`,
      status: "completed",
      approvalStatus: "pending",
      orderIndex: index,
      objectKey: storedObjectKey,
      mimeType: parsed.mimeType,
      metadataJson: JSON.stringify({ sourceId: frame.sourceId, atSeconds: frame.atSeconds, sampleKind: frame.sampleKind, extraction: "on-device decoded frame" }),
      createdAt: now,
      updatedAt: now,
    });
  }
  await db.update(productionRuns).set({ status: "evidence_uploaded", error: null, updatedAt: now }).where(eq(productionRuns.id, production.run.id));
  traceProduction(production, "evidence_ready_for_analysis", { previousPhase: "importing_reference_evidence", status: "ready" });
  return refreshProduction(production);
}

async function analyzeEvidence(production: OwnedProduction, apiKey: string): Promise<OwnedProduction> {
  if (production.run.currentStage !== "evidence") throw new Error("Reference evidence is already protected for this production run.");
  const db = getDb();
  const [dossier] = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.kind, "reference_dossier"),
  )).limit(1);
  if (!dossier) throw new Error("The production dossier could not be opened.");
  const evidenceArtifacts = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    inArray(productionArtifacts.kind, ["reference_frame", "reference_clip"]),
  )).orderBy(asc(productionArtifacts.orderIndex));
  const now = new Date().toISOString();
  await db.update(productionArtifacts).set({ status: "working", error: null, updatedAt: now }).where(eq(productionArtifacts.id, dossier.id));
  await db.update(productionRuns).set({ status: "analyzing_evidence", error: null, updatedAt: now }).where(eq(productionRuns.id, production.run.id));
  traceProduction(production, "analyzing_evidence", { previousPhase: production.run.status, providerRequestStarted: false });
  try {
    const result = await analyzeReferenceEvidence(production, evidenceArtifacts, apiKey);
    const completedAt = new Date().toISOString();
    await db.update(productionArtifacts).set({
      status: "completed",
      model: result.model,
      actualCostUsd: result.cost === null ? null : result.cost.toFixed(5),
      metadataJson: JSON.stringify({ ...result.dossier, analyzedAt: completedAt, lineage: "protected references → Gemini multimodal evidence dossier" }),
      updatedAt: completedAt,
    }).where(eq(productionArtifacts.id, dossier.id));
    await db.update(productionRuns).set({ status: "evidence_ready", error: null, updatedAt: completedAt }).where(eq(productionRuns.id, production.run.id));
    await recomputeRunCost(production.run.id);
    traceProduction(production, "evidence_ready", { previousPhase: "analyzing_evidence", providerRequestStarted: true, status: "ready" });
    return refreshProduction(production);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reference analysis failed. No retry was made.";
    await db.update(productionArtifacts).set({ status: "failed", error: message, updatedAt: new Date().toISOString() }).where(eq(productionArtifacts.id, dossier.id));
    await db.update(productionRuns).set({ status: "stage_failed", error: message, updatedAt: new Date().toISOString() }).where(eq(productionRuns.id, production.run.id));
    traceProduction(production, "failed", { previousPhase: "analyzing_evidence", status: "failed", error: message });
    throw error;
  }
}

async function runQc(production: OwnedProduction, apiKey: string): Promise<OwnedProduction> {
  if (production.run.currentStage !== "qc") throw new Error("Assemble and approve the director cut before continuity QC.");
  const db = getDb();
  const [master] = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    inArray(productionArtifacts.kind, ["master_cut", "review_cut"]),
    eq(productionArtifacts.status, "completed"),
  )).limit(1);
  const [report] = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.kind, "qc_report"),
  )).limit(1);
  if (!master || !report) throw new Error("The assembled master or QC record is missing.");
  const now = new Date().toISOString();
  await db.update(productionArtifacts).set({ status: "working", error: null, updatedAt: now }).where(eq(productionArtifacts.id, report.id));
  await db.update(productionRuns).set({ status: "running_qc", error: null, updatedAt: now }).where(eq(productionRuns.id, production.run.id));
  traceProduction(production, "running_qc", { previousPhase: production.run.status, providerRequestStarted: false });
  try {
    const result = await analyzeMasterQc(production, master, apiKey);
    const completedAt = new Date().toISOString();
    await db.update(productionArtifacts).set({
      status: "completed",
      approvalStatus: result.report.verdict === "pass" ? "approved" : "blocked",
      approvedAt: result.report.verdict === "pass" ? completedAt : null,
      model: result.model,
      actualCostUsd: result.cost === null ? null : result.cost.toFixed(5),
      metadataJson: JSON.stringify({ ...result.report, analyzedAt: completedAt, lineage: "assembled master + ground-truth references → Gemini multimodal QC" }),
      updatedAt: completedAt,
    }).where(eq(productionArtifacts.id, report.id));
    await db.update(productionRuns).set({
      currentStage: result.report.verdict === "pass" ? "master" : "qc",
      status: result.report.verdict === "pass" ? "master_ready" : "qc_blocked",
      error: result.report.verdict === "pass" ? null : "QC found blocking continuity defects. Revise only the listed shots.",
      updatedAt: completedAt,
    }).where(eq(productionRuns.id, production.run.id));
    await recomputeRunCost(production.run.id);
    traceProduction(production, result.report.verdict === "pass" ? "master_ready" : "qc_blocked", { previousPhase: "running_qc", providerRequestStarted: true, status: result.report.verdict === "pass" ? "ready" : "blocked" });
    return refreshProduction(production);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Continuity QC failed. No retry was made.";
    await db.update(productionArtifacts).set({ status: "failed", error: message, updatedAt: new Date().toISOString() }).where(eq(productionArtifacts.id, report.id));
    await db.update(productionRuns).set({ status: "stage_failed", error: message, updatedAt: new Date().toISOString() }).where(eq(productionRuns.id, production.run.id));
    traceProduction(production, "failed", { previousPhase: "running_qc", status: "failed", error: message });
    throw error;
  }
}

async function regenerateShot(production: OwnedProduction, shotId: string): Promise<OwnedProduction> {
  const db = getDb();
  const now = new Date().toISOString();
  const upperShotId = shotId.toUpperCase();
  const affectedArtifacts = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.shotId, upperShotId),
  ));
  if (!affectedArtifacts.length) throw new Error(`No artifacts found for shot ${upperShotId}.`);
  for (const artifact of affectedArtifacts) {
    if (artifact.status === "completed" || artifact.status === "failed") {
      await db.update(productionArtifacts).set({
        status: "planned",
        approvalStatus: "pending",
        error: null,
        objectKey: null,
        actualCostUsd: null,
        metadataJson: JSON.stringify({ ...metadata(artifact.metadataJson), regeneratedAt: now, previousStatus: artifact.status }),
        updatedAt: now,
      }).where(eq(productionArtifacts.id, artifact.id));
    }
  }
  const [dirRow] = await db.select().from(directions).where(eq(directions.id, production.run.directionId)).limit(1);
  if (dirRow) {
    const card = JSON.parse(dirRow.directionJson) as { approvalStage?: string; lockedAt?: string | null; revisionPlan?: unknown };
    if (card.revisionPlan || card.approvalStage !== "complete" || !card.lockedAt) {
      const lockedCard = { ...card, approvalStage: "complete" as const, lockedAt: now, revisionPlan: null };
      await db.update(directions).set({ directionJson: JSON.stringify(lockedCard), updatedAt: now }).where(eq(directions.id, dirRow.id));
    }
  }
  await db.update(productionRuns).set({
    status: "stage_ready",
    error: null,
    updatedAt: now,
  }).where(eq(productionRuns.id, production.run.id));
  return refreshProduction(production);
}

async function resetFailedArtifact(production: OwnedProduction, artifactId: string): Promise<OwnedProduction> {
  const db = getDb();
  const [artifact] = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.id, artifactId),
    eq(productionArtifacts.runId, production.run.id),
  )).limit(1);
  if (!artifact || artifact.status !== "failed") throw new Error("Choose a failed artifact.");
  const now = new Date().toISOString();
  const artifactMetadata = metadata(artifact.metadataJson);
  const usesExistingApproval = artifactMetadata.interruptedRequest === true
    && artifactMetadata.retryUsesExistingApproval === true
    && ["identity", "storyboard", "motion"].includes(artifact.stage)
    && production.run.approvedCostUsd !== null
    && artifact.estimatedCostUsd !== null;
  if (usesExistingApproval) {
    await db.update(productionArtifacts).set({
      status: "planned",
      approvalStatus: "pending",
      error: null,
      metadataJson: JSON.stringify({
        ...artifactMetadata,
        interruptedRequest: false,
        retryUsesExistingApproval: false,
        manualRetryPreparedAt: now,
      }),
      updatedAt: now,
    }).where(eq(productionArtifacts.id, artifact.id));
    await db.update(productionRuns).set({
      status: "generating_images",
      error: null,
      updatedAt: now,
    }).where(eq(productionRuns.id, production.run.id));
    return refreshProduction(production);
  }
  await db.update(productionArtifacts).set({
    status: "planned",
    approvalStatus: "pending",
    model: null,
    estimatedCostUsd: null,
    error: null,
    updatedAt: now,
  }).where(eq(productionArtifacts.id, artifact.id));
  await db.update(productionRuns).set({
    status: ["identity", "storyboard", "motion"].includes(production.run.currentStage) ? "awaiting_budget" : production.run.status,
    estimatedCostUsd: null,
    approvedCostUsd: null,
    error: null,
    updatedAt: now,
  }).where(eq(productionRuns.id, production.run.id));
  return refreshProduction(production);
}

export async function GET(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? "";
    const directionId = url.searchParams.get("directionId") ?? "";
    const includeQuote = url.searchParams.get("quote") !== "false";
    if (!projectId || !directionId) return Response.json({ error: "Choose a locked project first." }, { status: 400 });
    const production = await ensureProduction(ownerEmail, projectId, directionId);
    return Response.json({ production: await publicProduction(production, includeQuote) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Production could not be opened.";
    return Response.json({ error: message }, { status: 409 });
  }
}

export async function POST(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  try {
    const body = (await request.json()) as {
      projectId?: string;
      directionId?: string;
      action?: string;
      stage?: ProductionStage;
      approvedMaxCostUsd?: number;
      frames?: ReferenceEvidenceFrame[];
      artifactId?: string;
      shotId?: string;
      artifactIds?: string[];
      prompt?: string;
    };
    if (!body.projectId || !body.directionId || !body.action) return Response.json({ error: "Production action is incomplete." }, { status: 400 });
    let production = await ensureProduction(ownerEmail, body.projectId, body.directionId);
    const includeQuote = ["approve_stage", "ingest_evidence", "analyze_evidence", "reset_failed_artifact"].includes(body.action);
    const isStreamedAiAction = ["analyze_evidence", "generate_next_image", "run_qc"].includes(body.action);
    const streamedApiKey = isStreamedAiAction ? await getOpenRouterKey() : null;
    if (isStreamedAiAction && !streamedApiKey) {
      return Response.json({ error: "Reconnect OpenRouter before AI evidence analysis." }, { status: 409 });
    }
    const execute = async () => {
      if (body.action === "ingest_evidence") {
        production = await ingestEvidence(production, Array.isArray(body.frames) ? body.frames : []);
      } else if (body.action === "analyze_evidence") {
        production = await analyzeEvidence(production, streamedApiKey!);
      } else if (body.action === "approve_stage" && body.stage) {
        production = await approveCurrentStage(production, body.stage);
      } else if (body.action === "approve_budget" && body.stage && typeof body.approvedMaxCostUsd === "number") {
        production = await approveBudget(production, body.stage, body.approvedMaxCostUsd);
      } else if (body.action === "generate_next_image") {
        production = await generateNextImage(production, streamedApiKey!);
      } else if (body.action === "submit_next_motion") {
        production = await submitNextMotion(production, new URL(request.url).origin);
      } else if (body.action === "submit_score") {
        production = await submitScore(production, new URL(request.url).origin);
      } else if (body.action === "skip_voice") {
        production = await skipVoice(production);
      } else if (body.action === "skip_score") {
        production = await skipScore(production);
      } else if (body.action === "run_qc") {
        production = await runQc(production, streamedApiKey!);
      } else if (body.action === "reset_failed_artifact" && body.artifactId) {
        production = await resetFailedArtifact(production, body.artifactId);
      } else if (body.action === "regenerate_shot" && typeof body.shotId === "string") {
        production = await regenerateShot(production, body.shotId);
      } else if (body.action === "regenerate_with_prompt" && Array.isArray(body.artifactIds) && typeof body.prompt === "string") {
        const db = getDb();
        const now = new Date().toISOString();
        const artifactIds = body.artifactIds.filter((id): id is string => typeof id === "string").slice(0, 12);
        if (!artifactIds.length) throw new Error("No artifacts selected for regeneration.");
        const affected = await db.select().from(productionArtifacts).where(and(
          eq(productionArtifacts.runId, production.run.id),
          inArray(productionArtifacts.id, artifactIds),
        ));
        const shotIdsToReset = new Set<string>();
        for (const artifact of affected) {
          if (artifact.status === "completed" || artifact.status === "failed") {
            shotIdsToReset.add(artifact.shotId ?? "UNKNOWN");
            await db.update(productionArtifacts).set({
              status: "planned",
              approvalStatus: "pending",
              error: null,
              objectKey: null,
              actualCostUsd: null,
              metadataJson: JSON.stringify({ ...metadata(artifact.metadataJson), regeneratedAt: now, previousStatus: artifact.status, regenerationPrompt: body.prompt }),
              updatedAt: now,
            }).where(eq(productionArtifacts.id, artifact.id));
          }
        }
        for (const shotId of shotIdsToReset) {
          if (shotId && shotId !== "UNKNOWN") {
            const shotArtifacts = await db.select().from(productionArtifacts).where(and(
              eq(productionArtifacts.runId, production.run.id),
              eq(productionArtifacts.shotId, shotId),
            ));
            for (const a of shotArtifacts) {
              if ((a.status === "completed" || a.status === "failed") && !artifactIds.includes(a.id)) {
                await db.update(productionArtifacts).set({
                  status: "planned",
                  approvalStatus: "pending",
                  error: null,
                  objectKey: null,
                  actualCostUsd: null,
                  metadataJson: JSON.stringify({ ...metadata(a.metadataJson), regeneratedAt: now, previousStatus: a.status }),
                  updatedAt: now,
                }).where(eq(productionArtifacts.id, a.id));
              }
            }
          }
        }
        await db.update(productionRuns).set({ status: "stage_ready", error: null, updatedAt: now }).where(eq(productionRuns.id, production.run.id));
        production = await refreshProduction(production);
      } else {
        throw new Error("Unknown or incomplete production action.");
      }
      return { production: await publicProduction(production, includeQuote), traceId: production.run.id };
    };
    if (isStreamedAiAction) {
      return streamedJsonTask(execute, { "X-HAYK-Trace-Id": production.run.id });
    }
    return Response.json(await execute(), { headers: { "Cache-Control": "private, no-store", "X-HAYK-Trace-Id": production.run.id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Production action failed. No retry was made.";
    return Response.json({ error: message }, { status: 409 });
  }
}
