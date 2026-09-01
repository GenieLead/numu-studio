import type { productionArtifacts, references } from "@/db/schema";
import { openRouterHeaders } from "@/lib/openrouter-session";
import { parseJsonWithLocalRepair } from "@/lib/json-repair";
import { effectiveProductionHardGates, guardEvidenceDossier, lockSafeProductionShotPlan } from "@/lib/production-guardrails";
import type { OwnedProduction } from "@/lib/production-server";
import { ANALYSIS_MODEL } from "@/lib/production-studio";
import { getBucket } from "@/lib/storage";

type ArtifactRow = typeof productionArtifacts.$inferSelect;
type ReferenceRow = typeof references.$inferSelect;
const PRODUCTION_AI_TIMEOUT_MS = 65_000;

const EVIDENCE_DOSSIER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", maxLength: 900 },
    visualFindings: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          observation: { type: "string", maxLength: 400 },
          evidenceSeconds: { type: "array", maxItems: 8, items: { type: "number" } },
          productionUse: { type: "string", maxLength: 400 },
        },
        required: ["observation", "evidenceSeconds", "productionUse"],
      },
    },
    editMap: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          beat: { type: "string", maxLength: 180 },
          evidenceSeconds: { type: "array", maxItems: 8, items: { type: "number" } },
          grammar: { type: "string", maxLength: 400 },
        },
        required: ["beat", "evidenceSeconds", "grammar"],
      },
    },
    audio: {
      type: "object",
      additionalProperties: false,
      properties: {
        actuallyAnalyzed: { type: "boolean" },
        speech: { type: "string", maxLength: 400 },
        language: { type: "string", maxLength: 160 },
        music: { type: "string", maxLength: 400 },
        effects: { type: "string", maxLength: 400 },
        reuseDecision: { type: "string", maxLength: 500 },
      },
      required: ["actuallyAnalyzed", "speech", "language", "music", "effects", "reuseDecision"],
    },
    productionTranslations: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
    forbiddenTransfers: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
    continuityRisks: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
  },
  required: ["summary", "visualFindings", "editMap", "audio", "productionTranslations", "forbiddenTransfers", "continuityRisks"],
} as const;

const QC_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["pass", "revise"] },
    summary: { type: "string", maxLength: 900 },
    gates: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", maxLength: 160 },
          result: { type: "string", enum: ["pass", "warn", "fail"] },
          evidenceSeconds: { type: "array", maxItems: 8, items: { type: "number" } },
          note: { type: "string", maxLength: 500 },
          shotIds: { type: "array", maxItems: 7, items: { type: "string", maxLength: 8 } },
        },
        required: ["name", "result", "evidenceSeconds", "note", "shotIds"],
      },
    },
    blockingShotIds: { type: "array", maxItems: 7, items: { type: "string", maxLength: 8 } },
    audioReview: { type: "string", maxLength: 600 },
  },
  required: ["verdict", "summary", "gates", "blockingShotIds", "audioReview"],
} as const;

export type ReferenceDossier = {
  summary: string;
  analysisMethod: "bounded_av_window" | "full_multimodal_video" | "sampled_storyboard" | "image_evidence";
  sourceSecondsAnalyzed: number;
  framesAnalyzed: number;
  visualFindings: Array<{ observation: string; evidenceSeconds: number[]; productionUse: string }>;
  editMap: Array<{ beat: string; evidenceSeconds: number[]; grammar: string }>;
  audio: {
    actuallyAnalyzed: boolean;
    speech: string;
    language: string;
    music: string;
    effects: string;
    reuseDecision: string;
  };
  productionTranslations: string[];
  forbiddenTransfers: string[];
  continuityRisks: string[];
};

export type QcReport = {
  verdict: "pass" | "revise";
  summary: string;
  gates: Array<{
    name: string;
    result: "pass" | "warn" | "fail";
    evidenceSeconds: number[];
    note: string;
    shotIds: string[];
  }>;
  blockingShotIds: string[];
  audioReview: string;
};

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
  if (!object) throw new Error("A protected production asset is missing.");
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function extractJson(content: string): Record<string, unknown> {
  try {
    return parseJsonWithLocalRepair(content) as Record<string, unknown>;
  } catch {
    throw new Error("The evidence report was incomplete. The source remains saved and no production render was started. Retry this analysis.");
  }
}

function textValue(value: unknown, fallback: string, maximum = 800): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : fallback;
}

function stringList(value: unknown, maximum = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .slice(0, maximum)
    .map((item) => item.trim().slice(0, 300));
}

function numberList(value: unknown, maximum = 8): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    .slice(0, maximum)
    .map((item) => Number(item.toFixed(2)));
}

function usageCost(payload: Record<string, unknown>): number | null {
  const usage = payload.usage;
  if (!usage || typeof usage !== "object") return null;
  const cost = (usage as Record<string, unknown>).cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : null;
}

async function analyzeJson(
  apiKey: string,
  content: Array<Record<string, unknown>>,
  system: string,
  maxTokens: number,
  schemaName: string,
  schema: unknown,
  trace: { runId: string; projectId: string; directionId: string; phase: string },
): Promise<{ json: Record<string, unknown>; cost: number | null }> {
  if (!apiKey) throw new Error("Reconnect OpenRouter before AI evidence analysis.");
  console.info(JSON.stringify({
    event: "hayk.production.provider",
    traceId: trace.runId,
    operationId: trace.runId,
    projectId: trace.projectId,
    directionId: trace.directionId,
    currentPhase: trace.phase,
    provider: "OpenRouter",
    model: ANALYSIS_MODEL,
    providerRequestStarted: true,
  }));
  let response: Response;
  let text: string;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: openRouterHeaders(apiKey),
      signal: AbortSignal.timeout(PRODUCTION_AI_TIMEOUT_MS),
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        temperature: 0.1,
        max_completion_tokens: maxTokens,
        reasoning: { max_tokens: 1024, exclude: true },
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
      }),
    });
    text = await response.text();
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      throw new Error("AI production analysis timed out after 65 seconds. The current artifacts remain saved and no retry was made.");
    }
    throw error;
  }
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(text) as Record<string, unknown>; } catch { payload = {}; }
  if (!response.ok) {
    const error = payload.error;
    const message = error && typeof error === "object" ? (error as Record<string, unknown>).message : null;
    throw new Error(typeof message === "string" ? message : `AI evidence analysis failed (${response.status}). No retry was made.`);
  }
  const choices = payload.choices;
  const first = Array.isArray(choices) ? choices[0] : null;
  const finishReason = first && typeof first === "object" ? (first as Record<string, unknown>).finish_reason : null;
  if (finishReason === "length") {
    throw new Error("The evidence report reached its bounded output limit. The evidence remains saved and no retry was made.");
  }
  if (finishReason === "error") {
    throw new Error("The evidence-analysis provider interrupted the response. The evidence remains saved and no retry was made.");
  }
  const message = first && typeof first === "object" ? (first as Record<string, unknown>).message : null;
  const raw = message && typeof message === "object" ? (message as Record<string, unknown>).content : null;
  const responseContent = typeof raw === "string"
    ? raw
    : Array.isArray(raw)
      ? raw.map((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string" ? (item as Record<string, unknown>).text : "").join("")
      : "";
  const json = extractJson(responseContent);
  console.info(JSON.stringify({
    event: "hayk.production.provider",
    traceId: trace.runId,
    operationId: trace.runId,
    projectId: trace.projectId,
    directionId: trace.directionId,
    currentPhase: trace.phase,
    provider: "OpenRouter",
    model: ANALYSIS_MODEL,
    providerRequestStarted: true,
    providerResponseReceived: true,
  }));
  return { json, cost: usageCost(payload) };
}

function roleRows(production: OwnedProduction): Array<{ binding: OwnedProduction["bindings"][number]; row: ReferenceRow }> {
  const rowById = new Map(production.referenceRows.map((row) => [row.id, row]));
  return production.bindings.flatMap((binding) => {
    const row = rowById.get(binding.id);
    return row ? [{ binding, row }] : [];
  }).filter((item, index, all) => all.findIndex((candidate) => candidate.row.id === item.row.id) === index);
}

export async function analyzeReferenceEvidence(
  production: OwnedProduction,
  frameArtifacts: ArtifactRow[],
  apiKey: string,
): Promise<{ dossier: ReferenceDossier; cost: number | null; model: string }> {
  const sources = roleRows(production);
  const boundedClip = frameArtifacts.find((artifact) => artifact.kind === "reference_clip" && artifact.objectKey && artifact.mimeType?.startsWith("video/"));
  const fullSource = production.card.referenceAnalysis.mode === "inspiration" ? undefined : sources.find(({ binding, row }) =>
    ["style", "motion", "raw", "patch"].includes(binding.role)
    && row.mimeType.startsWith("video/")
    && (binding.durationSeconds ?? Number.POSITIVE_INFINITY) <= 60
    && row.byteSize <= 8 * 1024 * 1024,
  );
  const exactSourceVideo = sources.find(({ binding, row }) =>
    ["style", "motion", "raw", "patch"].includes(binding.role) && row.mimeType.startsWith("video/"),
  );
  if (production.card.referenceAnalysis.mode !== "inspiration" && exactSourceVideo && !fullSource) {
    throw new Error(
      "This exact-source job exceeds the single-pass analysis limit. It requires an explicitly quoted segmented full-source intake before production; HAYK will not pretend that sampled stills fully analyzed the footage.",
    );
  }
  const clipMetadata = boundedClip ? (() => { try { return JSON.parse(boundedClip.metadataJson) as Record<string, unknown>; } catch { return {}; } })() : null;
  const method: ReferenceDossier["analysisMethod"] = fullSource
    ? "full_multimodal_video"
    : boundedClip
      ? "bounded_av_window"
      : frameArtifacts.some((artifact) => artifact.kind === "reference_frame")
        ? "sampled_storyboard"
        : "image_evidence";
  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: [
      `LOCKED FILM: ${production.card.title}`,
      `Creative promise: ${production.card.creativePromise}`,
      `Final duration: ${production.card.deliverySeconds}s`,
      `Reference policy: ${JSON.stringify(production.card.referenceAnalysis)}`,
      `Shot plan: ${lockSafeProductionShotPlan(production.card).map((shot) => `${shot.id} ${shot.time} ${shot.title}: ${shot.action}`).join(" | ")}`,
      `NON-NEGOTIABLE HARD GATES: ${effectiveProductionHardGates(production.card).join(" | ")}`,
      `LOCKED ELEMENTS: ${production.card.lockedElements.join(" | ")}`,
      "Create a timestamped production dossier. Separate what is visibly/audibly evidenced from inference. Translate grammar into production rules; never transfer a different brand, person, bottle, text, voice or music recording.",
    ].join("\n"),
  }];

  let attachedIdentityBytes = 0;
  for (const { binding, row } of sources.filter(({ binding, row }) => ["product", "character", "location"].includes(binding.role) && row.mimeType.startsWith("image/"))) {
    if (attachedIdentityBytes + row.byteSize > 6 * 1024 * 1024) continue;
    attachedIdentityBytes += row.byteSize;
    content.push({ type: "text", text: `${binding.role.toUpperCase()} authority — identity evidence only: ${row.filename}` });
    content.push({ type: "image_url", image_url: { url: await objectDataUrl(row.objectKey, row.mimeType) } });
  }

  if (fullSource) {
    content.push({
      type: "text",
      text: `EXPLICIT FULL-SOURCE MULTIMODAL ANALYSIS — analyze picture, edit timing, speech, language, music structure and effects across ${fullSource.binding.durationSeconds?.toFixed(1) ?? "the supplied"} seconds. The founder requested a source edit or close adaptation; no audio or branded content may be reused without rights approval.`,
    });
    content.push({
      type: "video_url",
      video_url: { url: await objectDataUrl(fullSource.row.objectKey, fullSource.row.mimeType) },
    });
  } else if (boundedClip?.objectKey && boundedClip.mimeType) {
    content.push({
      type: "text",
      text: `BOUNDED AUDIOVISUAL WINDOW — analyze the actual picture, speech, language, music structure and effects in this ${Number(clipMetadata?.windowDurationSeconds ?? 0).toFixed(1)}-second locally extracted window. This is an inspiration reference; the full source was deliberately not uploaded.`,
    });
    content.push({ type: "video_url", video_url: { url: await objectDataUrl(boundedClip.objectKey, boundedClip.mimeType) } });
  }
  for (const artifact of frameArtifacts.filter((candidate) => candidate.kind === "reference_frame").slice(0, 18)) {
    if (!artifact.objectKey || !artifact.mimeType) continue;
    const frameMetadata = (() => { try { return JSON.parse(artifact.metadataJson) as Record<string, unknown>; } catch { return {}; } })();
    content.push({ type: "text", text: `GLOBAL REFERENCE FRAME at ${Number(frameMetadata.atSeconds ?? 0).toFixed(2)}s (${frameMetadata.sampleKind ?? "sample"}). Use these stills to map the rest of the source timeline; do not claim to hear audio outside the bounded audiovisual window.` });
    content.push({ type: "image_url", image_url: { url: await objectDataUrl(artifact.objectKey, artifact.mimeType) } });
  }

  const { json, cost } = await analyzeJson(
    apiKey,
    content,
    "You are the evidence unit for a high-end film production system. Analyze only supplied evidence. Return JSON with summary, visualFindings [{observation,evidenceSeconds,productionUse}], editMap [{beat,evidenceSeconds,grammar}], audio {actuallyAnalyzed,speech,language,music,effects,reuseDecision}, productionTranslations, forbiddenTransfers, continuityRisks. If any audiovisual video is supplied, analyze its actual audio and timestamps only within that supplied window. If only still frames are supplied, set audio.actuallyAnalyzed=false and do not claim to hear anything. Distinguish hard cuts from camera movement. Identify shot-scale progression, lighting behavior, palette, material motifs, pacing and sound architecture. Every productionUse and productionTranslation must preserve the supplied hard gates, locked object states and protected identity. If a reference suggests a prohibited action or state change, record it only under forbiddenTransfers and never recommend it for production. Never claim exact camera hardware unless visible metadata proves it. JSON only.",
    4200,
    "hayk_evidence_dossier",
    EVIDENCE_DOSSIER_SCHEMA,
    { runId: production.run.id, projectId: production.run.projectId, directionId: production.run.directionId, phase: "analyzing_evidence" },
  );
  const visualFindings = Array.isArray(json.visualFindings) ? json.visualFindings.slice(0, 10).map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      observation: textValue(record.observation, "Unspecified visual observation", 400),
      evidenceSeconds: numberList(record.evidenceSeconds),
      productionUse: textValue(record.productionUse, "Use as grammar only", 400),
    };
  }) : [];
  const editMap = Array.isArray(json.editMap) ? json.editMap.slice(0, 10).map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      beat: textValue(record.beat, "Reference beat", 180),
      evidenceSeconds: numberList(record.evidenceSeconds),
      grammar: textValue(record.grammar, "Observable cut grammar", 400),
    };
  }) : [];
  const rawAudio = json.audio && typeof json.audio === "object" ? json.audio as Record<string, unknown> : {};
  const audioActuallyAnalyzed = (method === "full_multimodal_video" || method === "bounded_av_window") && rawAudio.actuallyAnalyzed === true;
  const dossier: ReferenceDossier = guardEvidenceDossier(production.card, {
      summary: textValue(json.summary, "Reference evidence mapped for production.", 900),
      analysisMethod: method,
      sourceSecondsAnalyzed: fullSource?.binding.durationSeconds ?? Number(clipMetadata?.windowDurationSeconds ?? 0),
      framesAnalyzed: frameArtifacts.filter((artifact) => artifact.kind === "reference_frame").length,
      visualFindings,
      editMap,
      audio: {
        actuallyAnalyzed: audioActuallyAnalyzed,
        speech: audioActuallyAnalyzed ? textValue(rawAudio.speech, "No clear speech detected") : "Not analyzed from still frames",
        language: audioActuallyAnalyzed ? textValue(rawAudio.language, "Undetermined") : "Not analyzed",
        music: audioActuallyAnalyzed ? textValue(rawAudio.music, "No clear music detected") : "Not analyzed",
        effects: audioActuallyAnalyzed ? textValue(rawAudio.effects, "No distinct effects detected") : "Not analyzed",
        reuseDecision: textValue(rawAudio.reuseDecision, "Quarantine reference audio; create or license a new soundtrack"),
      },
      productionTranslations: stringList(json.productionTranslations, 10),
      forbiddenTransfers: stringList(json.forbiddenTransfers, 10),
      continuityRisks: stringList(json.continuityRisks, 10),
    });
  return {
    dossier,
    cost,
    model: ANALYSIS_MODEL,
  };
}

export async function analyzeMasterQc(
  production: OwnedProduction,
  master: ArtifactRow,
  apiKey: string,
): Promise<{ report: QcReport; cost: number | null; model: string }> {
  if (!master.objectKey || !master.mimeType) throw new Error("Assemble the master before continuity QC.");
  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: [
      `QC MASTER: ${production.card.title} (${production.card.deliverySeconds}s)` ,
      `Approved shots: ${lockSafeProductionShotPlan(production.card).map((shot) => `${shot.id} ${shot.time}: ${shot.action}`).join(" | ")}`,
      `Hard gates: ${effectiveProductionHardGates(production.card).join(" | ")}`,
      "Inspect every visible frame and the actual soundtrack. A beautiful result still fails if product geometry, character identity, wardrobe/anatomy, action physics, timing or audio rights are wrong.",
    ].join("\n"),
  }];
  for (const { binding, row } of roleRows(production).filter(({ binding, row }) => ["product", "character"].includes(binding.role) && row.mimeType.startsWith("image/"))) {
    content.push({ type: "text", text: `${binding.role.toUpperCase()} GROUND TRUTH: ${row.filename}` });
    content.push({ type: "image_url", image_url: { url: await objectDataUrl(row.objectKey, row.mimeType) } });
  }
  content.push({ type: "text", text: "ASSEMBLED MASTER WITH ACTUAL EDIT AND AUDIO:" });
  content.push({ type: "video_url", video_url: { url: await objectDataUrl(master.objectKey, master.mimeType) } });
  const { json, cost } = await analyzeJson(
    apiKey,
    content,
    "You are an unforgiving continuity supervisor, product VFX supervisor, editor and re-recording mixer. Compare the supplied assembled master against product and character ground truth and the approved shot plan. Return JSON with verdict pass|revise, summary, gates [{name,result pass|warn|fail,evidenceSeconds,note,shotIds}], blockingShotIds, audioReview. Required gates: product geometry/logo/material, character/wardrobe/anatomy, action physics and object state, shot order/timing, edit cleanliness, audio continuity/originality, unwanted text/watermarks. Use fail for any identity substitution, morph, duplicate product/limb, impossible action, missing promised beat, copyrighted/reference audio transfer, or unreadable product hero. JSON only.",
    3200,
    "hayk_master_qc",
    QC_REPORT_SCHEMA,
    { runId: production.run.id, projectId: production.run.projectId, directionId: production.run.directionId, phase: "running_qc" },
  );
  const gates = Array.isArray(json.gates) ? json.gates.slice(0, 12).map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const result: "pass" | "warn" | "fail" = record.result === "fail" || record.result === "warn" ? record.result : "pass";
    return {
      name: textValue(record.name, "QC gate", 160),
      result,
      evidenceSeconds: numberList(record.evidenceSeconds),
      note: textValue(record.note, "No issue recorded", 500),
      shotIds: stringList(record.shotIds, 5).filter((id) => /^S\d{2}$/i.test(id)).map((id) => id.toUpperCase()),
    };
  }) : [];
  const blockingShotIds = [...new Set([
    ...stringList(json.blockingShotIds, 7),
    ...gates.filter((gate) => gate.result === "fail").flatMap((gate) => gate.shotIds),
  ].filter((id) => /^S\d{2}$/i.test(id)).map((id) => id.toUpperCase()))];
  const verdict = json.verdict === "pass" && !gates.some((gate) => gate.result === "fail") ? "pass" : "revise";
  return {
    report: {
      verdict,
      summary: textValue(json.summary, verdict === "pass" ? "Master passed the required gates." : "Master needs a targeted revision.", 900),
      gates,
      blockingShotIds,
      audioReview: textValue(json.audioReview, "Audio review was not returned.", 600),
    },
    cost,
    model: ANALYSIS_MODEL,
  };
}
