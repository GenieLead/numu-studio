import { and, desc, eq, inArray } from "drizzle-orm";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { getDb } from "@/db";
import { directions, jobs, projects, references } from "@/db/schema";
import {
  DIRECTOR_CONTRACT_VERSION,
  createDirectorCard,
  createRevisionPlan,
  explicitFilmRuntimeSeconds,
  mergeShotRevision,
  revisionShotIds,
  storyBeatsFromShots,
  type DirectorCard,
  type ApprovalSection,
  type ReferenceBinding,
  type ReferenceRole,
} from "@/lib/director";
import { enhanceDirectorCard, enhanceRevisionPrompt, enhanceShotPlan } from "@/lib/creative-ai";
import { evaluateConceptQuality } from "@/lib/concept-quality";
import { repairFilmGrammar } from "@/lib/film-grammar";
import { getOpenRouterKey } from "@/lib/openrouter-session";
import { lockSafeProductionShotPlan, productionLockIssues } from "@/lib/production-guardrails";
import { activeProject } from "@/lib/projects";
import { streamedJsonTask } from "@/lib/streamed-json";

function validBinding(value: unknown): value is ReferenceBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as { id?: unknown; role?: unknown; durationSeconds?: unknown };
  return (
    typeof binding.id === "string" &&
    ["product", "character", "location", "style", "motion", "audio", "start", "end", "raw", "patch"].includes(binding.role as ReferenceRole) &&
    (binding.durationSeconds === undefined || (typeof binding.durationSeconds === "number" && Number.isFinite(binding.durationSeconds) && binding.durationSeconds > 0 && binding.durationSeconds <= 3600))
  );
}

function sameBindings(left: ReferenceBinding[], right: ReferenceBinding[]): boolean {
  const canonical = (items: ReferenceBinding[]) => items
    .map((binding) => `${binding.id}:${binding.role}:${binding.durationSeconds ?? ""}`)
    .sort();
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function normalizedPrompt(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function traceDirection(
  row: { id: string; projectId: string; phase: string },
  detail: { previousPhase?: string | null; providerRequestStarted?: boolean; status?: string; error?: string | null } = {},
): void {
  console.info(JSON.stringify({
    event: "hayk.direction.phase",
    traceId: row.id,
    operationId: row.id,
    projectId: row.projectId,
    currentPhase: row.phase,
    previousPhase: detail.previousPhase ?? null,
    providerRequestStarted: detail.providerRequestStarted ?? false,
    status: detail.status ?? "processing",
    error: detail.error ?? null,
  }));
}

type StoryboardFrame = {
  sourceId: string;
  atSeconds: number;
  dataUrl: string;
  sampleKind?: "global" | "deep";
};

const MAX_LOCAL_STORYBOARD_FRAMES = 18;
const MAX_LOCAL_STORYBOARD_BYTES = 4_500_000;
function validStoryboardFrame(value: unknown): value is StoryboardFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as { sourceId?: unknown; atSeconds?: unknown; dataUrl?: unknown; sampleKind?: unknown };
  return typeof frame.sourceId === "string" &&
    typeof frame.atSeconds === "number" && Number.isFinite(frame.atSeconds) && frame.atSeconds >= 0 &&
    typeof frame.dataUrl === "string" && /^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(frame.dataUrl) && frame.dataUrl.length <= 350_000 &&
    (frame.sampleKind === undefined || frame.sampleKind === "global" || frame.sampleKind === "deep");
}

export async function GET(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
  const project = projectId ? await activeProject(ownerEmail, projectId) : null;
  if (!project) {
    return Response.json({ error: "Choose a project first." }, { status: 400 });
  }
  const recent = await getDb()
    .select()
    .from(directions)
    .where(and(eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)))
    .orderBy(desc(directions.createdAt))
    .limit(20);
  const latestOperation = recent[0] && recent[0].status !== "ready" ? recent[0] : null;
  const readyRecent = recent.filter((row) => row.status === "ready");
  const latest = readyRecent[0];
  const draftBindings = (() => {
    try {
      return (JSON.parse(project.draftReferenceIdsJson || "[]") as unknown[]).filter(validBinding).slice(0, 12);
    } catch {
      return [];
    }
  })();
  const latestBindings = latest ? (() => {
    try {
      return (JSON.parse(latest.referenceIdsJson || "[]") as unknown[]).filter(validBinding).slice(0, 12);
    } catch {
      return [];
    }
  })() : [];
  const duplicateCheckpointDraft = Boolean(
    latest &&
    normalizedPrompt(project.draftPrompt) === normalizedPrompt(latest.prompt) &&
    sameBindings(draftBindings, latestBindings),
  );
  if (duplicateCheckpointDraft && (project.draftPrompt || draftBindings.length)) {
    await getDb().update(projects).set({
      draftPrompt: null,
      draftReferenceIdsJson: "[]",
      updatedAt: new Date().toISOString(),
    }).where(and(eq(projects.id, projectId), eq(projects.ownerEmail, ownerEmail)));
  }
  const draftReferenceIds = duplicateCheckpointDraft ? [] : draftBindings.map((binding) => binding.id);
  const draftReferenceRows = draftReferenceIds.length
    ? await getDb()
        .select()
        .from(references)
        .where(and(eq(references.ownerEmail, ownerEmail), eq(references.projectId, projectId), inArray(references.id, draftReferenceIds)))
        .orderBy(desc(references.createdAt))
    : [];
  const draftBindingById = new Map(draftBindings.map((binding) => [binding.id, binding]));
  const draft = !duplicateCheckpointDraft && (project.draftPrompt || draftReferenceRows.length)
    ? {
        prompt: project.draftPrompt ?? "",
        references: draftReferenceRows.map((reference) => ({
          ...reference,
          role: draftBindingById.get(reference.id)?.role,
          durationSeconds: draftBindingById.get(reference.id)?.durationSeconds,
        })),
      }
    : null;
  const chronological = [...recent].reverse();
  const historyBindings = chronological.map((row) => {
    try {
      return (JSON.parse(row.referenceIdsJson) as unknown[]).filter(validBinding);
    } catch {
      return [];
    }
  });
  const ids = [...new Set(historyBindings.flatMap((items) => items.map((binding) => binding.id)))];
  const referenceRows = ids.length
    ? await getDb()
        .select()
        .from(references)
        .where(and(eq(references.ownerEmail, ownerEmail), eq(references.projectId, projectId), inArray(references.id, ids)))
    : [];
  const referenceById = new Map(referenceRows.map((reference) => [reference.id, reference]));
  const seenReferenceIds = new Set<string>();
  const history = chronological.map((row, index) => {
    const rowBindings = historyBindings[index];
    const introduced = rowBindings.filter((binding) => !seenReferenceIds.has(binding.id));
    rowBindings.forEach((binding) => seenReferenceIds.add(binding.id));
    return {
      id: row.id,
      prompt: row.prompt,
      createdAt: row.createdAt,
      status: row.status,
      phase: row.currentPhase,
      error: row.error,
      references: introduced.flatMap((binding) => {
        const reference = referenceById.get(binding.id);
        return reference ? [{ ...reference, role: binding.role, durationSeconds: binding.durationSeconds }] : [];
      }),
    };
  });
  const operation = latestOperation ? {
    id: latestOperation.id,
    traceId: latestOperation.id,
    status: latestOperation.status,
    phase: latestOperation.currentPhase,
    previousPhase: latestOperation.previousPhase,
    providerRequestStarted: latestOperation.providerRequestStarted,
    error: latestOperation.error,
    retryable: latestOperation.retryable,
    createdAt: latestOperation.createdAt,
    updatedAt: latestOperation.updatedAt,
  } : null;
  if (!latest) return Response.json({ direction: null, history, draft, operation });

  let latestCard = JSON.parse(latest.directionJson) as DirectorCard;
  let repairedConceptCheckpoint = false;
  const repairedGrammar = repairFilmGrammar(latestCard.filmGrammar);
  if (JSON.stringify(repairedGrammar) !== JSON.stringify(latestCard.filmGrammar)) {
    latestCard = { ...latestCard, filmGrammar: repairedGrammar };
    repairedConceptCheckpoint = true;
  }
  const rememberedRuntime = readyRecent
    .map((row) => explicitFilmRuntimeSeconds(row.prompt))
    .find((runtime): runtime is number => runtime !== null);
  if (rememberedRuntime !== undefined && (
    latestCard.deliverySeconds !== rememberedRuntime ||
    latestCard.referenceAnalysis.requestedRuntimeSeconds !== rememberedRuntime
  )) {
    latestCard = {
      ...latestCard,
      deliverySeconds: rememberedRuntime,
      format: latestCard.format.replace(/^\d+(?:\.\d+)?-second\b/i, `${rememberedRuntime}-second`),
      referenceAnalysis: { ...latestCard.referenceAnalysis, requestedRuntimeSeconds: rememberedRuntime },
    };
    repairedConceptCheckpoint = true;
  }
  if ((latestCard.approvalStage ?? "concept") !== "concept" && latestCard.revisionPlan?.target === "Concept strategy only") {
    latestCard = { ...latestCard, revisionPlan: null };
    repairedConceptCheckpoint = true;
  }
  if (
    latestCard.analysisProvenance?.contractVersion === DIRECTOR_CONTRACT_VERSION &&
    latestCard.conceptStrategy
  ) {
    const refreshedQuality = evaluateConceptQuality(
      latestCard.conceptStrategy,
      latestCard.analysisProvenance.storyboardFrameCount,
    );
    if (JSON.stringify(refreshedQuality) !== JSON.stringify(latestCard.conceptQuality)) {
      latestCard = { ...latestCard, conceptQuality: refreshedQuality };
      repairedConceptCheckpoint = true;
    }
  }
  if (
    latestCard.revisionPlan &&
    (latestCard.approvalStage ?? "concept") === "concept" &&
    latestCard.analysisProvenance?.contractVersion === DIRECTOR_CONTRACT_VERSION
  ) {
    let priorBindings: ReferenceBinding[] = [];
    try {
      if (!readyRecent[1]) throw new Error("No prior checkpoint");
      priorBindings = (JSON.parse(readyRecent[1].referenceIdsJson) as unknown[]).filter(validBinding);
    } catch {
      priorBindings = [];
    }
    const exactConceptReplay = Boolean(
      readyRecent[1] &&
      normalizedPrompt(latest.prompt) === normalizedPrompt(readyRecent[1].prompt) &&
      sameBindings(latestBindings, priorBindings),
    );
    const repairedRevisionPlan = exactConceptReplay
      ? null
      : createRevisionPlan(latest.prompt, [], "concept");
    if (JSON.stringify(repairedRevisionPlan) !== JSON.stringify(latestCard.revisionPlan)) {
      latestCard = { ...latestCard, revisionPlan: repairedRevisionPlan };
      repairedConceptCheckpoint = true;
    }
  }
  if (repairedConceptCheckpoint) {
    await getDb().update(directions).set({ directionJson: JSON.stringify(latestCard) })
      .where(and(eq(directions.id, latest.id), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)));
  }
  if (!latestCard.approvalStage) {
    const [completedMaster] = await getDb()
      .select({ updatedAt: jobs.updatedAt })
      .from(jobs)
      .where(and(eq(jobs.ownerEmail, ownerEmail), eq(jobs.projectId, projectId), eq(jobs.status, "completed")))
      .orderBy(desc(jobs.updatedAt))
      .limit(1);

    if (completedMaster) {
      latestCard = {
        ...latestCard,
        approvalStage: "complete",
        approvedSections: ["concept", "language", "shots", "sound"],
        lockedAt: latestCard.lockedAt ?? completedMaster.updatedAt,
      };
      await getDb()
        .update(directions)
        .set({ directionJson: JSON.stringify(latestCard) })
        .where(and(eq(directions.id, latest.id), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)));
    }
  }

  const requestedShotIds = revisionShotIds(latest.prompt);
  if (latestCard.revisionPlan && requestedShotIds.length && readyRecent[1]) {
    const previousCard = JSON.parse(readyRecent[1].directionJson) as DirectorCard;
    const repairedShots = mergeShotRevision(previousCard.shotPlan, latestCard.shotPlan, requestedShotIds);
    const protectVisualWorld = (latestCard.approvedSections ?? []).includes("language");
    const repairedCard: DirectorCard = {
      ...latestCard,
      shotPlan: repairedShots,
      storyBeats: storyBeatsFromShots(repairedShots),
      revisionPlan: createRevisionPlan(latest.prompt, requestedShotIds),
      ...(protectVisualWorld ? {
        filmGrammar: previousCard.filmGrammar,
        referenceAnalysis: previousCard.referenceAnalysis,
        referenceIntelligence: previousCard.referenceIntelligence,
        lockedElements: previousCard.lockedElements,
      } : {}),
    };
    if (JSON.stringify(repairedCard) !== JSON.stringify(latestCard)) {
      latestCard = repairedCard;
      await getDb().update(directions).set({ directionJson: JSON.stringify(latestCard) })
        .where(and(eq(directions.id, latest.id), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)));
    }
  }

  const currentBindingMap = new Map<string, ReferenceBinding>();
  historyBindings.flat().forEach((binding) => currentBindingMap.set(binding.id, binding));
  const bindings = [...currentBindingMap.values()];
  if ((latestCard.approvedSections ?? []).includes("concept") && !latestCard.conceptLock) {
    const repairLegacyAnalysis = latestCard.approvalStage === "language" && latestCard.referenceIntelligence?.status === "analyzed";
    const originalConcept = repairLegacyAnalysis ? createDirectorCard(latest.prompt, bindings) : latestCard;
    latestCard = {
      ...latestCard,
      title: originalConcept.title,
      creativePromise: originalConcept.creativePromise,
      objective: originalConcept.objective,
      audienceAction: originalConcept.audienceAction,
      conceptLock: {
        title: originalConcept.title,
        creativePromise: originalConcept.creativePromise,
        objective: originalConcept.objective,
        audienceAction: originalConcept.audienceAction,
        conceptStrategy: originalConcept.conceptStrategy,
        conceptQuality: originalConcept.conceptQuality,
      },
    };
    await getDb().update(directions).set({ directionJson: JSON.stringify(latestCard) })
      .where(and(eq(directions.id, latest.id), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)));
  }
  return Response.json({
    direction: {
      ...latest,
      card: latestCard,
      bindings,
      references: bindings.flatMap((binding) => {
        const reference = referenceById.get(binding.id);
        return reference ? [reference] : [];
      }),
    },
    history,
    draft,
    operation,
  });
}

export async function POST(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  try {
    const body = (await request.json()) as {
      prompt?: string;
      projectId?: unknown;
      references?: unknown[];
      previousDirectionId?: unknown;
      targetShotId?: unknown;
      targetShotIds?: unknown;
      taggedArtifacts?: unknown;
      autonomy?: unknown;
      storyboardFrames?: unknown[];
    };
    const prompt = body.prompt?.trim() ?? "";
    const taggedArtifacts = Array.isArray(body.taggedArtifacts) ? body.taggedArtifacts.filter((id): id is string => typeof id === "string") : [];
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const project = projectId ? await activeProject(ownerEmail, projectId) : null;
    if (!project) return Response.json({ error: "Choose a project before directing it." }, { status: 400 });
    const [inFlight] = await getDb().select().from(directions).where(and(
      eq(directions.ownerEmail, ownerEmail),
      eq(directions.projectId, projectId),
      eq(directions.status, "processing"),
    )).orderBy(desc(directions.updatedAt)).limit(1);
    if (inFlight) {
      const ageMs = Date.now() - new Date(inFlight.updatedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs <= 6 * 60 * 1_000) {
        return Response.json({
          error: "HAYK is already processing this project. The existing operation will resume without another provider request.",
          traceId: inFlight.id,
        }, { status: 409, headers: { "X-HAYK-Trace-Id": inFlight.id } });
      }
      const failedAt = new Date().toISOString();
      const watchdogError = "The previous director operation exceeded its six-minute watchdog. It was stopped without an automatic retry.";
      await getDb().update(directions).set({
        status: "failed",
        currentPhase: "failed",
        previousPhase: inFlight.currentPhase,
        phaseStartedAt: failedAt,
        error: watchdogError,
        retryable: true,
        updatedAt: failedAt,
      }).where(and(eq(directions.id, inFlight.id), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)));
      traceDirection({ id: inFlight.id, projectId, phase: "failed" }, {
        previousPhase: inFlight.currentPhase,
        providerRequestStarted: inFlight.providerRequestStarted,
        status: "failed",
        error: watchdogError,
      });
    }
    const bindings = (body.references ?? []).filter(validBinding).slice(0, 12);
    const storyboardFrames = (body.storyboardFrames ?? []).filter(validStoryboardFrame).slice(0, MAX_LOCAL_STORYBOARD_FRAMES);
    const bindingIds = new Set(bindings.map((binding) => binding.id));
    if (storyboardFrames.some((frame) => !bindingIds.has(frame.sourceId))) {
      return Response.json({ error: "One or more storyboard frames could not be matched to a verified reference." }, { status: 400 });
    }
    if (storyboardFrames.reduce((total, frame) => total + frame.dataUrl.length, 0) > MAX_LOCAL_STORYBOARD_BYTES) {
      return Response.json({ error: "The local storyboard exceeded its safe analysis size." }, { status: 400 });
    }
    if (!prompt) return Response.json({ error: "Describe the idea first." }, { status: 400 });

    const ids = bindings.map((binding) => binding.id);
    const owned = ids.length
      ? await getDb()
          .select()
          .from(references)
          .where(and(eq(references.ownerEmail, ownerEmail), eq(references.projectId, projectId), inArray(references.id, ids)))
      : [];
    if (owned.length !== ids.length) {
      return Response.json({ error: "One or more references could not be verified." }, { status: 400 });
    }
    const rowById = new Map(owned.map((reference) => [reference.id, reference]));
    const requiresStoryboard = bindings.some((binding) => {
      const reference = rowById.get(binding.id);
      return reference?.mimeType.startsWith("video/") && ["style", "motion", "raw", "patch"].includes(binding.role);
    });
    const previousDirectionId = typeof body.previousDirectionId === "string" ? body.previousDirectionId : "";
    const targetShotIds = revisionShotIds(prompt, [
      ...(Array.isArray(body.targetShotIds) ? body.targetShotIds : []),
      ...(typeof body.targetShotId === "string" ? [body.targetShotId] : []),
    ].filter((value): value is string => typeof value === "string").slice(0, 7));
    const [previousRow] = previousDirectionId
      ? await getDb()
          .select()
          .from(directions)
          .where(and(eq(directions.id, previousDirectionId), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)))
          .limit(1)
      : [];
    const previousCard = previousRow ? (JSON.parse(previousRow.directionJson) as DirectorCard) : null;
    let previousBindings: ReferenceBinding[] = [];
    if (previousRow) {
      try {
        previousBindings = (JSON.parse(previousRow.referenceIdsJson) as unknown[]).filter(validBinding);
      } catch {
        previousBindings = [];
      }
    }
    const exactCheckpointReplay = Boolean(
      previousRow &&
      !targetShotIds.length &&
      normalizedPrompt(prompt) === normalizedPrompt(previousRow.prompt) &&
      sameBindings(bindings, previousBindings),
    );
    if (!exactCheckpointReplay) {
      await getDb().update(projects).set({
        draftPrompt: prompt,
        draftReferenceIdsJson: JSON.stringify(bindings),
        updatedAt: new Date().toISOString(),
      }).where(and(eq(projects.id, projectId), eq(projects.ownerEmail, ownerEmail)));
    }
    if (previousRow && previousCard && !targetShotIds.length) {
      if (
        previousCard.analysisProvenance?.contractVersion === DIRECTOR_CONTRACT_VERSION &&
        previousCard.conceptQuality?.status === "passed" &&
        normalizedPrompt(prompt) === normalizedPrompt(previousRow.prompt) &&
        sameBindings(bindings, previousBindings)
      ) {
        await getDb().update(projects).set({
          draftPrompt: null,
          draftReferenceIdsJson: "[]",
          updatedAt: new Date().toISOString(),
        }).where(and(eq(projects.id, projectId), eq(projects.ownerEmail, ownerEmail)));
        return Response.json({
          direction: { ...previousRow, card: previousCard, bindings: previousBindings },
          reused: true,
        });
      }
    }
    if (requiresStoryboard && storyboardFrames.length === 0 && previousCard?.referenceIntelligence?.status !== "analyzed") {
      return Response.json({ error: "HAYK could not sample the reference video on this device. No generic direction was saved." }, { status: 422 });
    }

    const id = crypto.randomUUID();
    const fallbackCard = createDirectorCard(enhancedPrompt, bindings, previousCard, targetShotIds);
    if (previousDirectionId) {
      (fallbackCard as DirectorCard & { previousDirectionId?: string }).previousDirectionId = previousDirectionId;
    }
    if (exactCheckpointReplay && (previousCard?.approvalStage ?? "concept") === "concept") {
      fallbackCard.revisionPlan = null;
    }
    if (["Autopilot", "Collaborative", "Expert"].includes(body.autonomy as string)) {
      fallbackCard.autonomy = body.autonomy as DirectorCard["autonomy"];
    }
    const decisionOnly = /^Decision\s+(voiceover|music)\s*:/i.test(prompt);
    const directorApiKey = decisionOnly ? "" : await getOpenRouterKey();
    if (!decisionOnly && !directorApiKey) {
      return Response.json({ error: "Reconnect OpenRouter before HAYK analyzes the references." }, { status: 409 });
    }

    let enhancedPrompt = prompt;
    if (taggedArtifacts.length > 0 && directorApiKey) {
      const artifactLabels = taggedArtifacts.slice(0, 10);
      enhancedPrompt = await enhanceRevisionPrompt(directorApiKey, prompt, artifactLabels);
    }

    const shouldPlanShots = targetShotIds.length > 0 || Boolean(previousCard && ["shots", "sound", "final", "complete"].includes(previousCard.approvalStage ?? "concept"));
    const reuseAnalyzedWorld = Boolean(
      previousCard?.referenceIntelligence?.status === "analyzed" &&
      sameBindings(bindings, previousBindings),
    );
    const acceptedAt = new Date().toISOString();
    let activePhase = decisionOnly || shouldPlanShots || reuseAnalyzedWorld ? "planning" : "analyzing_reference";
    let providerRequestStarted = false;
    await getDb().insert(directions).values({
      id,
      ownerEmail,
      projectId,
      prompt: enhancedPrompt,
      referenceIdsJson: JSON.stringify(bindings),
      directionJson: JSON.stringify(fallbackCard),
      status: "processing",
      currentPhase: activePhase,
      previousPhase: "submitted",
      phaseStartedAt: acceptedAt,
      providerRequestStarted: false,
      error: null,
      retryable: false,
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
    });
    await getDb().update(projects).set({
      draftPrompt: null,
      draftReferenceIdsJson: "[]",
      updatedAt: acceptedAt,
    }).where(and(eq(projects.id, projectId), eq(projects.ownerEmail, ownerEmail)));
    traceDirection({ id, projectId, phase: activePhase }, {
      previousPhase: "submitted",
      providerRequestStarted: false,
    });

    return streamedJsonTask(async () => {
      try {
        const markProviderRequest = async (phase: "analyzing_reference" | "planning") => {
          providerRequestStarted = true;
          const now = new Date().toISOString();
          const previousPhase = activePhase;
          activePhase = phase;
          await getDb().update(directions).set({
            currentPhase: activePhase,
            previousPhase,
            phaseStartedAt: now,
            providerRequestStarted: true,
            updatedAt: now,
          }).where(and(eq(directions.id, id), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)));
          traceDirection({ id, projectId, phase: activePhase }, { previousPhase, providerRequestStarted: true });
        };
        const saveWorldCheckpoint = async (worldCard: DirectorCard) => {
          const now = new Date().toISOString();
          const previousPhase = activePhase;
          activePhase = "planning";
          await getDb().update(directions).set({
            directionJson: JSON.stringify(worldCard),
            currentPhase: activePhase,
            previousPhase,
            phaseStartedAt: now,
            updatedAt: now,
          }).where(and(eq(directions.id, id), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)));
          traceDirection({ id, projectId, phase: activePhase }, { previousPhase, providerRequestStarted: true });
        };
        const card = decisionOnly
          ? fallbackCard
          : shouldPlanShots
            ? await enhanceShotPlan(directorApiKey, enhancedPrompt, bindings, fallbackCard, previousCard, targetShotIds, markProviderRequest)
            : await enhanceDirectorCard(directorApiKey, enhancedPrompt, bindings, owned, fallbackCard, storyboardFrames, reuseAnalyzedWorld, saveWorldCheckpoint, markProviderRequest);
        const completedAt = new Date().toISOString();
        const [row] = await getDb().update(directions).set({
          directionJson: JSON.stringify(card),
          status: "ready",
          currentPhase: "ready",
          previousPhase: activePhase,
          phaseStartedAt: completedAt,
          error: null,
          retryable: false,
          updatedAt: completedAt,
        }).where(and(eq(directions.id, id), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId))).returning();
        await getDb().update(projects).set({
          name: project.name === "Untitled film" ? card.title : project.name,
          draftPrompt: null,
          draftReferenceIdsJson: "[]",
          updatedAt: completedAt,
        }).where(and(eq(projects.id, projectId), eq(projects.ownerEmail, ownerEmail)));
        traceDirection({ id, projectId, phase: "ready" }, {
          previousPhase: activePhase,
          providerRequestStarted,
          status: "ready",
        });
        return { direction: { ...row, card, bindings }, traceId: id };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Direction could not be prepared.";
        const failedAt = new Date().toISOString();
        await getDb().update(directions).set({
          status: "failed",
          currentPhase: "failed",
          previousPhase: activePhase,
          phaseStartedAt: failedAt,
          error: message,
          retryable: true,
          updatedAt: failedAt,
        }).where(and(eq(directions.id, id), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)));
        traceDirection({ id, projectId, phase: "failed" }, {
          previousPhase: activePhase,
          providerRequestStarted,
          status: "failed",
          error: message,
        });
        throw error;
      }
    }, { "X-HAYK-Trace-Id": id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Direction could not be prepared.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  try {
    const body = (await request.json()) as {
      directionId?: unknown;
      projectId?: unknown;
      locked?: unknown;
      approveStep?: unknown;
      reanalyzeReferences?: unknown;
      storyboardFrames?: unknown[];
    };
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    if (typeof body.directionId !== "string" || !projectId || !await activeProject(ownerEmail, projectId)) {
      return Response.json({ error: "A valid project direction was not provided." }, { status: 400 });
    }
    const [existing] = await getDb()
      .select()
      .from(directions)
      .where(and(eq(directions.id, body.directionId), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)))
      .limit(1);
    if (!existing) return Response.json({ error: "This treatment could not be found." }, { status: 404 });
    if (existing.status !== "ready") {
      return Response.json({ error: "Wait for the current director operation to finish before approving it." }, { status: 409 });
    }

    const card = JSON.parse(existing.directionJson) as DirectorCard;
    if (body.reanalyzeReferences === true) {
      if ((card.approvalStage ?? "concept") !== "language") {
        return Response.json({ error: "Reference analysis belongs to the visual-world checkpoint." }, { status: 409 });
      }
      const bindings = (JSON.parse(existing.referenceIdsJson) as unknown[]).filter(validBinding).slice(0, 12);
      const storyboardFrames = (body.storyboardFrames ?? []).filter(validStoryboardFrame).slice(0, MAX_LOCAL_STORYBOARD_FRAMES);
      const bindingIds = new Set(bindings.map((binding) => binding.id));
      if (!storyboardFrames.length || storyboardFrames.some((frame) => !bindingIds.has(frame.sourceId))) {
        return Response.json({ error: "HAYK needs verified sampled frames before the visual world can be approved." }, { status: 400 });
      }
      if (storyboardFrames.reduce((total, frame) => total + frame.dataUrl.length, 0) > MAX_LOCAL_STORYBOARD_BYTES) {
        return Response.json({ error: "The local storyboard exceeded its safe analysis size." }, { status: 400 });
      }
      const ids = [...new Set(bindings.map((binding) => binding.id))];
      const owned = ids.length
        ? await getDb().select().from(references)
            .where(and(eq(references.ownerEmail, ownerEmail), eq(references.projectId, projectId), inArray(references.id, ids)))
        : [];
      if (owned.length !== ids.length) {
        return Response.json({ error: "One or more references could not be verified." }, { status: 400 });
      }
      const apiKey = await getOpenRouterKey();
      if (!apiKey) return Response.json({ error: "Reconnect OpenRouter before HAYK analyzes the references." }, { status: 409 });
      const analyzedCard = await enhanceDirectorCard(apiKey, existing.prompt, bindings, owned, card, storyboardFrames);
      if (analyzedCard.referenceIntelligence.status !== "analyzed") {
        throw new Error("HAYK did not return verified reference intelligence. Nothing was approved.");
      }
      const [updated] = await getDb().update(directions)
        .set({ directionJson: JSON.stringify(analyzedCard) })
        .where(and(eq(directions.id, body.directionId), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)))
        .returning();
      await getDb().update(projects).set({ updatedAt: new Date().toISOString() })
        .where(and(eq(projects.id, projectId), eq(projects.ownerEmail, ownerEmail)));
      return Response.json({ direction: { ...updated, card: analyzedCard } });
    }
    if (typeof body.approveStep === "string") {
      const order: ApprovalSection[] = ["concept", "language", "shots", "sound"];
      const current = card.approvalStage ?? "concept";
      const requested = body.approveStep as ApprovalSection;
      if (!order.includes(requested) || current !== requested) {
        return Response.json({ error: "That section is no longer the active approval step." }, { status: 409 });
      }
      if (requested === "sound" && (card.creativeDecisions ?? []).some((decision) => decision.status === "open")) {
        return Response.json({ error: "Choose the open sound options before approving sound." }, { status: 409 });
      }
      if (requested === "concept" && (
        card.analysisProvenance?.contractVersion !== DIRECTOR_CONTRACT_VERSION ||
        card.conceptQuality?.status !== "passed" ||
        !card.conceptStrategy
      )) {
        return Response.json({ error: "This concept has not passed the staged creative quality gate. Upgrade it before approval." }, { status: 409 });
      }
      const approvalBindings = (JSON.parse(existing.referenceIdsJson) as unknown[]).filter(validBinding).slice(0, 12);
      const approvalApiKey = requested === "language" ? await getOpenRouterKey() : null;
      if (requested === "language" && !approvalApiKey) {
        return Response.json({ error: "Reconnect OpenRouter before HAYK designs the shot graph." }, { status: 409 });
      }
      let cardForApproval = requested === "language"
        ? await enhanceShotPlan(approvalApiKey!, existing.prompt, approvalBindings, card)
        : card;
      if (requested === "language") {
        const safeShotPlan = lockSafeProductionShotPlan(cardForApproval);
        cardForApproval = {
          ...cardForApproval,
          shotPlan: safeShotPlan,
          storyBeats: storyBeatsFromShots(safeShotPlan),
        };
      }
      if (["language", "shots"].includes(requested)) {
        const issues = productionLockIssues(cardForApproval);
        if (issues.length) {
          return Response.json({ error: `The shot sequence still conflicts with its protected production contract: ${issues.join(" ")} Nothing was approved.` }, { status: 409 });
        }
      }
      const index = order.indexOf(requested);
      const approvedSections = [...new Set([...(cardForApproval.approvedSections ?? []), requested])] as ApprovalSection[];
      const conceptLock = requested === "concept"
        ? cardForApproval.conceptLock ?? {
            title: cardForApproval.title,
            creativePromise: cardForApproval.creativePromise,
            objective: cardForApproval.objective,
            audienceAction: cardForApproval.audienceAction,
            conceptStrategy: cardForApproval.conceptStrategy,
            conceptQuality: cardForApproval.conceptQuality,
          }
        : cardForApproval.conceptLock;
      const approvedCard: DirectorCard = {
        ...cardForApproval,
        revisionPlan: requested === "concept" ? null : cardForApproval.revisionPlan,
        approvedSections,
        conceptLock,
        approvalStage: index === order.length - 1 ? "final" : order[index + 1],
      };
      const [updated] = await getDb().update(directions).set({ directionJson: JSON.stringify(approvedCard) })
        .where(and(eq(directions.id, body.directionId), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId))).returning();
      await getDb().update(projects).set({ updatedAt: new Date().toISOString() })
        .where(and(eq(projects.id, projectId), eq(projects.ownerEmail, ownerEmail)));
      return Response.json({ direction: { ...updated, card: approvedCard } });
    }

    if (body.locked !== true) {
      return Response.json({ error: "A valid treatment lock was not provided." }, { status: 400 });
    }
    if (card.approvalStage && card.approvalStage !== "final" && card.approvalStage !== "complete") {
      return Response.json({ error: "Approve each direction section before locking the treatment." }, { status: 409 });
    }
    if ((card.creativeDecisions ?? []).some((decision) => decision.status === "open")) {
      return Response.json({ error: "Resolve the open sound decisions before locking the treatment." }, { status: 409 });
    }
    const lockIssues = productionLockIssues(card);
    if (lockIssues.length) {
      return Response.json({ error: `The direction cannot lock while its shots contradict the production contract: ${lockIssues.join(" ")}` }, { status: 409 });
    }
    const lockedCard: DirectorCard = { ...card, approvalStage: "complete", lockedAt: new Date().toISOString() };
    const [updated] = await getDb()
      .update(directions)
      .set({ directionJson: JSON.stringify(lockedCard) })
      .where(and(eq(directions.id, body.directionId), eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)))
      .returning();
    await getDb().update(projects).set({ updatedAt: new Date().toISOString() })
      .where(and(eq(projects.id, projectId), eq(projects.ownerEmail, ownerEmail)));
    return Response.json({ direction: { ...updated, card: lockedCard } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The treatment could not be locked.";
    return Response.json({ error: message }, { status: 500 });
  }
}
