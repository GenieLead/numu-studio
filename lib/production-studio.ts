import type { DirectorCard, ReferenceBinding, ShotSpec } from "@/lib/director";
import {
  effectiveProductionHardGates,
  lockSafeProductionShot,
  safeProductionTranslations,
} from "@/lib/production-guardrails";

export const PRODUCTION_PIPELINE_VERSION = "studio-v5";
export const IMAGE_MODEL_PREFERENCES = [
  "openai/dall-e-3",
  "stabilityai/stable-diffusion-xl",
  "google/gemini-2.0-flash-exp:free",
  "google/gemini-2.5-flash-preview",
  "bytedance-seed/seedream-5-0-pro",
  "bytedance-seed/seedream-4.5",
  "google/gemini-3-pro-image",
] as const;
export const MOTION_MODEL = "bytedance/seedance-2.5";
export const SOURCE_EDIT_MODEL_PREFERENCES = [
  "runway/aleph-2",
  "bytedance/seedance-2.5",
] as const;
export const DIRECTOR_MODEL = "google/gemini-2.5-pro";
export const ANALYSIS_MODEL = "google/gemini-2.5-pro";
export const MOTION_CLIP_SECONDS = 4;
export const MOTION_RESOLUTION = "720p" as const;
export const MOTION_ASPECT_RATIO = "9:16";
export const IMAGE_RESOLUTION = "1K";
export const IMAGE_ASPECT_RATIO = "9:16";

export type ProductionStage =
  | "evidence"
  | "identity"
  | "storyboard"
  | "motion"
  | "voice"
  | "score"
  | "stems"
  | "conform"
  | "qc"
  | "master";

export const PRODUCTION_STAGES: ProductionStage[] = [
  "evidence",
  "identity",
  "storyboard",
  "motion",
  "voice",
  "score",
  "stems",
  "conform",
  "qc",
  "master",
];

export type ProductionArtifactPublic = {
  id: string;
  stage: ProductionStage;
  kind: string;
  shotId: string | null;
  label: string;
  status: string;
  approvalStatus: string;
  orderIndex: number;
  mediaUrl: string | null;
  mimeType: string | null;
  model: string | null;
  metadata: Record<string, unknown>;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  error: string | null;
};

export type ShotRouteContract = {
  shotId: string;
  mode: "generate" | "source_edit" | "hybrid";
  primaryCapability: "generated-motion" | "source-edit" | "localized-vfx";
  preserve: string[];
  change: string[];
  sourceReferenceId: string | null;
  handlesSeconds: number;
  audioPolicy: "generated_scratch" | "preserve_source" | "separate_stems";
  approvalRequired: true;
};

export function shotRouteContract(shot: ShotSpec, bindings: ReferenceBinding[]): ShotRouteContract {
  const source = bindings.find((binding) => ["raw", "patch"].includes(binding.role));
  const isEdit = Boolean(source);
  return {
    shotId: shot.id,
    mode: isEdit ? "source_edit" : "generate",
    primaryCapability: isEdit ? "source-edit" : "generated-motion",
    preserve: isEdit
      ? ["source performance", "source timing", "face and body identity", "original audio stem"]
      : ["approved first frame", "approved landing frame", "product and character locks"],
    change: isEdit ? ["only explicitly named visual layers"] : ["motion between approved frame boundaries"],
    sourceReferenceId: source?.id ?? null,
    handlesSeconds: 0.5,
    audioPolicy: isEdit ? "preserve_source" : "generated_scratch",
    approvalRequired: true,
  };
}

export type ProductionTaskPublic = {
  id: string;
  artifactId: string;
  status: string;
  model: string;
  maxCostUsd: number;
  actualCostUsd: number | null;
  error: string | null;
};

export type ProductionQuotePublic = {
  stage: ProductionStage;
  routeName: string;
  model: string;
  modelName: string;
  itemCount: number;
  unitSeconds: number | null;
  estimatedCostUsd: number;
  maxCostUsd: number;
  remainingUsd: number | null;
  fundingSufficient: boolean | null;
  provider: string | null;
  includes: string[];
  quotedAt: string;
};

export type ProductionRunPublic = {
  id: string;
  directionId: string;
  projectId: string;
  pipelineVersion: string;
  mode: string;
  currentStage: ProductionStage;
  status: string;
  estimatedCostUsd: number | null;
  approvedCostUsd: number | null;
  actualCostUsd: number;
  error: string | null;
  artifacts: ProductionArtifactPublic[];
  tasks: ProductionTaskPublic[];
  quote: ProductionQuotePublic | null;
};

export type ReferenceEvidenceFrame = {
  sourceId: string;
  atSeconds: number;
  dataUrl: string;
  sampleKind: "global" | "deep";
};

export function parseDirectionCard(directionJson: string): DirectorCard {
  const card = JSON.parse(directionJson) as DirectorCard;
  if (card.approvalStage !== "complete" || !card.lockedAt) {
    throw new Error("Lock the complete direction before opening production.");
  }
  return card;
}

export function parseBindings(referenceIdsJson: string): ReferenceBinding[] {
  const parsed = JSON.parse(referenceIdsJson) as ReferenceBinding[];
  return Array.isArray(parsed) ? parsed : [];
}

export function shotDurationSeconds(shot: ShotSpec): number {
  const numbers = [...shot.time.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (numbers.length >= 2 && numbers[1] > numbers[0]) return Number((numbers[1] - numbers[0]).toFixed(2));
  return 1.6;
}

export function storyboardPrompt(
  card: DirectorCard,
  shot: ShotSpec,
  frameType: "start" | "end",
  dossier: Record<string, unknown> | null,
): string {
  const safeShot = lockSafeProductionShot(card, shot);
  const frameMoment = frameType === "start"
    ? "the exact first frame before the shot action begins"
    : "the exact landing frame after the shot action completes";
  const safeTranslations = safeProductionTranslations(card, dossier?.productionTranslations);
  const style = safeTranslations.length
    ? safeTranslations.slice(0, 5).join("; ")
    : card.referenceIntelligence.styleDNA.slice(0, 5).join("; ");
  return [
    `Create ${frameMoment} for ${safeShot.id} “${safeShot.title}” in a premium vertical 9:16 commercial storyboard.`,
    `Shot purpose: ${safeShot.purpose}`,
    `Observable action: ${safeShot.action}`,
    `Camera: ${safeShot.camera}`,
    `Locked visual world: ${card.filmGrammar.lighting}; ${card.filmGrammar.palette}; ${card.filmGrammar.camera}.`,
    style ? `Reference-derived grammar: ${style}.` : "",
    `Shot locks: ${safeShot.locks.join("; ")}.`,
    `Global hard gates: ${effectiveProductionHardGates(card).join("; ")}.`,
    "Use the supplied PRODUCT authority exactly for bottle silhouette, proportions, cap, facets, material, plaque and mark. Use the supplied CHARACTER authority exactly for the same covered person, body, wardrobe and falcon. Any different bottle or brand inside another reference is forbidden. Preserve covered skin and clothing. Do not invent typography, subtitles, watermarks, extra products, extra fingers or duplicate people. Photoreal live-action advertising frame, physically plausible, inspectable product geometry.",
  ].filter(Boolean).join("\n");
}

export function identityRolesForShot(shot: ShotSpec): Array<"product" | "character" | "location"> {
  const text = [shot.title, shot.purpose, shot.action, shot.camera, ...shot.locks].join(" ");
  const roles: Array<"product" | "character" | "location"> = [];
  if (/\b(?:product|bottle|NUMU|atomizer|nozzle|spray|fragrance|glass|cap)\b/i.test(text)) roles.push("product");
  if (/\b(?:character|person|falconer|falcon|hand|finger|wrist|skin|robe|wardrobe|body|face)\b/i.test(text)) roles.push("character");
  if (/\b(?:location|desert|terrain|dune|landscape|horizon|world)\b/i.test(text)) roles.push("location");
  return roles;
}

export function identityPlatePrompt(card: DirectorCard, kind: "product" | "character" | "location"): string {
  if (kind === "product") {
    return [
      "Create a canonical production identity plate of the exact supplied product, not a redesign.",
      "Show one clean upright frontal hero view centered in a vertical 9:16 frame, plus only subtle dimensional evidence in shadow. Preserve exact silhouette, shoulder-to-body ratio, cap height and diameter, facets, material, front plaque, embossed mark and all visible packaging geometry. Neutral controlled studio light. No hands, no character, no duplicate bottle, no invented text, no alternate cap, no morphing.",
      `The future film world is ${card.filmGrammar.palette}, but identity accuracy outranks styling.`,
    ].join("\n");
  }
  if (kind === "character") return [
    "Create a canonical production identity plate of the exact supplied character, not a recast or redesign.",
    "Show the same person, same body proportions, same fully covered head and neck, same black robe, same wardrobe construction and same falcon. Preserve every covered area; do not reveal hair, mouth, beard or neck. Neutral full-body three-quarter production portrait in a vertical 9:16 frame. No product, no alternate costume, no extra person, no duplicate bird, no typography.",
    `The future film world is ${card.filmGrammar.palette}, but identity accuracy outranks styling.`,
  ].join("\n");
  return [
    "Create a canonical production world plate from the exact supplied location evidence, not a different place.",
    "Preserve terrain, horizon behavior, ground texture, atmospheric density, time-of-day logic and practical light direction. Remove any unrelated people, products, logos, text or watermarks. Wide vertical 9:16 location continuity plate with believable scale and photographic realism.",
    `Match the locked palette and light only where consistent with the evidence: ${card.filmGrammar.palette}; ${card.filmGrammar.lighting}.`,
  ].join("\n");
}

export function motionPrompt(card: DirectorCard, shot: ShotSpec, dossier: Record<string, unknown> | null): string {
  const safeShot = lockSafeProductionShot(card, shot);
  const safeTranslations = safeProductionTranslations(card, dossier?.productionTranslations);
  const style = safeTranslations.length
    ? safeTranslations.slice(0, 6).join("; ")
    : card.referenceIntelligence.styleDNA.slice(0, 6).join("; ");
  const soundDecision = card.creativeDecisions
    .map((decision) => `${decision.id}: ${decision.answer ?? decision.recommended}`)
    .join("; ");
  return [
    `Produce one continuous 4-second source shot for ${safeShot.id} “${safeShot.title}”. It will be trimmed to ${shotDurationSeconds(safeShot).toFixed(2)} seconds in the locked edit.`,
    `Action must begin at the supplied first frame and arrive naturally at the supplied last frame: ${safeShot.action}`,
    `Camera behavior: ${safeShot.camera}`,
    `Shot purpose: ${safeShot.purpose}`,
    style ? `Reference-derived directing grammar: ${style}.` : "",
    `Identity and physics locks: ${safeShot.locks.join("; ")}. Global hard gates: ${effectiveProductionHardGates(card).join("; ")}. Preserve exact product geometry, cap/nozzle state, character wardrobe and anatomy across every frame. One product only. No morphing, substitution, duplicate limbs, exposed covered skin, text, watermark or unrelated brand.`,
    `Generate synchronized original audio for this isolated shot: ${safeShot.sound}. ${soundDecision}. Treat this as one stem of the same ${card.deliverySeconds}-second soundtrack: preserve one tonal center, tempo, instrumentation, ambience perspective and recurring motif across every source shot. The audio must enter and leave mid-phrase so editorial cuts can form one continuous mix; do not restart a cue at the head of the shot. Do not reproduce reference speech, melody, brand mnemonic or copyrighted recording.`,
    "Live-action commercial realism, stable temporal continuity, motivated motion only, no synthetic zoom, no montage inside this source shot.",
  ].filter(Boolean).join("\n");
}
