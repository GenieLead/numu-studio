import { openRouterHeaders } from "@/lib/openrouter-session";
import {
  IMAGE_ASPECT_RATIO,
  IMAGE_MODEL_PREFERENCES,
  IMAGE_RESOLUTION,
  MOTION_ASPECT_RATIO,
  MOTION_CLIP_SECONDS,
  MOTION_MODEL,
  MOTION_RESOLUTION,
  SOURCE_EDIT_MODEL_PREFERENCES,
  type ProductionQuotePublic,
  type ProductionStage,
} from "@/lib/production-studio";
import { selectVideoPricePerSecond } from "@/lib/video-pricing";

type Capability = { type?: string; values?: string[]; min?: number; max?: number };

type ImageModelRecord = {
  id?: string;
  name?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: Record<string, Capability>;
  endpoints?: string;
};

type ImageEndpointRecord = {
  provider_name?: string;
  provider_tag?: string | null;
  supported_parameters?: Record<string, Capability>;
  pricing?: Array<{
    billable?: string;
    unit?: string;
    cost_usd?: number | string;
    variant?: string;
  }>;
};

type VideoModelRecord = {
  id?: string;
  name?: string;
  supported_durations?: number[];
  supported_resolutions?: string[];
  supported_aspect_ratios?: string[];
  supported_frame_images?: string[];
  generate_audio?: boolean;
  pricing_skus?: Record<string, string>;
};

export type ImageRoute = {
  model: string;
  modelName: string;
  endpointUrl: string;
  providerTag: string;
  providerName: string;
  unitCostUsd: number;
  quote: ProductionQuotePublic;
};

export type ApprovedImageRoute = Pick<ImageRoute,
  "model" | "modelName" | "endpointUrl" | "providerTag" | "providerName" | "unitCostUsd"
>;

export type MotionRoute = {
  model: string;
  modelName: string;
  unitCostUsd: number;
  quote: ProductionQuotePublic;
};

export type SourceEditRoute = MotionRoute & { preservesSourceAudio: true };

function roundedCeiling(value: number): number {
  return Number((Math.ceil((value - Number.EPSILON) * 100) / 100).toFixed(2));
}

function supportsValue(capability: Capability | undefined, value: string): boolean {
  if (!capability) return false;
  return !Array.isArray(capability.values) || capability.values.includes(value);
}

function supportsReferenceCount(capability: Capability | undefined, count: number): boolean {
  if (!capability) return false;
  if (typeof capability.min === "number" && count < capability.min) return false;
  if (typeof capability.max === "number" && count > capability.max) return false;
  return true;
}

function normalizedCost(value: number | string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function endpointImageCost(endpoint: ImageEndpointRecord, referencesPerImage: number): number | null {
  const lines = endpoint.pricing ?? [];
  const output = lines
    .filter((line) => (line.billable === "output_image" || line.billable === "image" || (line.unit === "image" && !line.billable)) && line.unit === "image")
    .filter((line) => !line.variant || line.variant.toLowerCase() === IMAGE_RESOLUTION.toLowerCase())
    .map((line) => normalizedCost(line.cost_usd))
    .find((cost): cost is number => cost !== null);
  if (output === undefined) {
    const anyImageCost = lines
      .filter((line) => normalizedCost(line.cost_usd) !== null)
      .map((line) => normalizedCost(line.cost_usd))
      .find((cost): cost is number => cost !== null);
    return anyImageCost ?? null;
  }
  const referenceLine = lines
    .filter((line) => ["input_reference", "input_image"].includes(line.billable ?? "") && line.unit === "image")
    .map((line) => normalizedCost(line.cost_usd))
    .find((cost): cost is number => cost !== null);
  return output + (referenceLine ?? 0) * referencesPerImage;
}

export async function remainingCredits(apiKey: string): Promise<number | null> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: openRouterHeaders(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: { limit_remaining?: number } };
    return typeof payload.data?.limit_remaining === "number" ? payload.data.limit_remaining : null;
  } catch {
    return null;
  }
}

export async function imageRoute(
  apiKey: string,
  stage: Extract<ProductionStage, "identity" | "storyboard">,
  itemCount: number,
  referencesPerImage: number,
): Promise<ImageRoute> {
  const response = await fetch("https://openrouter.ai/api/v1/images/models", {
    headers: openRouterHeaders(apiKey),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Live image-model capabilities are unavailable. Nothing was spent.");
  const payload = (await response.json()) as { data?: ImageModelRecord[] };
  const models = payload.data ?? [];
  const model = IMAGE_MODEL_PREFERENCES
    .map((id) => models.find((candidate) => candidate.id === id))
    .find((candidate) => candidate
      && candidate.architecture?.output_modalities?.includes("image")
      && candidate.endpoints);
  if (!model?.id || !model.endpoints) {
    throw new Error("No verified reference-aware image route is currently available. Nothing was spent.");
  }
  const endpointUrl = new URL(model.endpoints, "https://openrouter.ai");
  if (endpointUrl.hostname !== "openrouter.ai" || !endpointUrl.pathname.startsWith("/api/v1/images/models/")) {
    throw new Error("OpenRouter returned an invalid image-route descriptor. Nothing was spent.");
  }
  const endpointResponse = await fetch(endpointUrl, { headers: openRouterHeaders(apiKey), cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!endpointResponse.ok) throw new Error("Exact image-route pricing is unavailable. Nothing was spent.");
  const endpointPayload = (await endpointResponse.json()) as { endpoints?: ImageEndpointRecord[] };
  const candidates = (endpointPayload.endpoints ?? [])
    .filter((endpoint) => endpoint.provider_tag)
    .map((endpoint) => ({ endpoint, cost: endpointImageCost(endpoint, referencesPerImage) }))
    .filter((candidate): candidate is { endpoint: ImageEndpointRecord & { provider_tag: string }; cost: number } => candidate.cost !== null)
    .sort((left, right) => left.cost - right.cost);
  const selected = candidates[0];
  if (!selected) throw new Error("No image provider published a verifiable per-image price. Nothing was spent.");
  const remainingUsd = await remainingCredits(apiKey);
  const estimatedCostUsd = Number((selected.cost * itemCount).toFixed(5));
  const maxCostUsd = roundedCeiling(estimatedCostUsd);
  return {
    model: model.id,
    modelName: model.name?.replace(/^[^:]+:\s*/i, "") || model.id,
    endpointUrl: endpointUrl.toString(),
    providerTag: selected.endpoint.provider_tag,
    providerName: selected.endpoint.provider_name || selected.endpoint.provider_tag,
    unitCostUsd: selected.cost,
    quote: {
      stage,
      routeName: stage === "identity" ? "Canonical identity plates" : "Shot start + landing keyframes",
      model: model.id,
      modelName: model.name?.replace(/^[^:]+:\s*/i, "") || model.id,
      itemCount,
      unitSeconds: null,
      estimatedCostUsd,
      maxCostUsd,
      remainingUsd,
      fundingSufficient: remainingUsd === null ? null : remainingUsd >= maxCostUsd,
      provider: selected.endpoint.provider_name || selected.endpoint.provider_tag,
      includes: stage === "identity"
        ? ["Exact product authority plate", "Exact character authority plate", "User approval before storyboards"]
        : ["First frame for every shot", "Landing frame for every shot", "Visible approval before motion"],
      quotedAt: new Date().toISOString(),
    },
  };
}

export async function revalidateApprovedImageRoute(
  apiKey: string,
  approved: ApprovedImageRoute,
  referencesPerImage: number,
): Promise<ApprovedImageRoute> {
  const endpointUrl = new URL(approved.endpointUrl, "https://openrouter.ai");
  if (endpointUrl.hostname !== "openrouter.ai" || !endpointUrl.pathname.startsWith("/api/v1/images/models/")) {
    throw new Error("The approved image route is invalid. Nothing was spent.");
  }
  try {
    const response = await fetch(endpointUrl, {
      headers: openRouterHeaders(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return approved;
    const payload = (await response.json()) as { endpoints?: ImageEndpointRecord[] };
    const endpoint = (payload.endpoints ?? []).find((candidate) => candidate.provider_tag === approved.providerTag);
    if (!endpoint) return approved;
    const unitCostUsd = endpointImageCost(endpoint, referencesPerImage);
    if (unitCostUsd === null) return approved;
    return {
      ...approved,
      providerName: endpoint.provider_name || approved.providerName,
      unitCostUsd,
    };
  } catch {
    return approved;
  }
}

export async function motionRoute(apiKey: string, itemCount: number): Promise<MotionRoute> {
  const response = await fetch("https://openrouter.ai/api/v1/videos/models", {
    headers: openRouterHeaders(apiKey),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Live video-model capabilities are unavailable. Nothing was spent.");
  const payload = (await response.json()) as { data?: VideoModelRecord[] };
  const model = payload.data?.find((candidate) => candidate.id === MOTION_MODEL);
  if (!model) throw new Error("Seedance 2.5 is not available on the connected route. Nothing was spent.");
  if (!model.supported_durations?.includes(MOTION_CLIP_SECONDS)) throw new Error("Seedance 2.5 no longer supports the required four-second source shots. Nothing was spent.");
  if (!model.supported_resolutions?.includes(MOTION_RESOLUTION)) throw new Error("Seedance 2.5 no longer supports 720p. Nothing was spent.");
  if (!model.supported_aspect_ratios?.includes(MOTION_ASPECT_RATIO)) throw new Error("Seedance 2.5 no longer supports vertical 9:16. Nothing was spent.");
  if (!model.supported_frame_images?.includes("first_frame") || !model.supported_frame_images.includes("last_frame")) throw new Error("Seedance 2.5 no longer supports both locked first and landing frames. Nothing was spent.");
  if (model.generate_audio !== true) throw new Error("Seedance 2.5 synchronized audio is unavailable. Nothing was spent.");
  const unitCostUsd = selectVideoPricePerSecond(model.pricing_skus ?? {}, {
    resolution: MOTION_RESOLUTION,
    audio: true,
    videoInput: false,
  });
  if (unitCostUsd === null) throw new Error("The exact Seedance 2.5 price could not be verified. Nothing was spent.");
  const perShotCost = unitCostUsd * MOTION_CLIP_SECONDS;
  const estimatedCostUsd = Number((perShotCost * itemCount).toFixed(5));
  const maxCostUsd = roundedCeiling(estimatedCostUsd);
  const remainingUsd = await remainingCredits(apiKey);
  return {
    model: MOTION_MODEL,
    modelName: model.name?.replace(/^[^:]+:\s*/i, "") || "Seedance 2.5",
    unitCostUsd: perShotCost,
    quote: {
      stage: "motion",
      routeName: "Shot-level Seedance 2.5 production",
      model: MOTION_MODEL,
      modelName: model.name?.replace(/^[^:]+:\s*/i, "") || "Seedance 2.5",
      itemCount,
      unitSeconds: MOTION_CLIP_SECONDS,
      estimatedCostUsd,
      maxCostUsd,
      remainingUsd,
      fundingSufficient: remainingUsd === null ? null : remainingUsd >= maxCostUsd,
      provider: null,
      includes: [
        `${itemCount} independently replaceable source shots`,
        "First + landing frame control",
        "Original synchronized audio per source shot",
        "Zero automatic retries",
      ],
      quotedAt: new Date().toISOString(),
    },
  };
}

export async function sourceEditRoute(apiKey: string, itemCount: number): Promise<SourceEditRoute> {
  const response = await fetch("https://openrouter.ai/api/v1/videos/models", {
    headers: openRouterHeaders(apiKey),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Live source-edit capabilities are unavailable. Nothing was spent.");
  const payload = (await response.json()) as { data?: VideoModelRecord[] };
  const model = SOURCE_EDIT_MODEL_PREFERENCES
    .map((id) => payload.data?.find((candidate) => candidate.id === id))
    .find((candidate) => candidate
      && candidate.supported_durations?.includes(MOTION_CLIP_SECONDS)
      && candidate.supported_resolutions?.includes(MOTION_RESOLUTION)
      && candidate.supported_aspect_ratios?.includes(MOTION_ASPECT_RATIO));
  if (!model?.id) throw new Error("No verified OpenRouter source-edit route currently supports this shot contract. Nothing was spent.");
  const pricePerSecond = selectVideoPricePerSecond(model.pricing_skus ?? {}, {
    resolution: MOTION_RESOLUTION,
    audio: false,
    videoInput: true,
  });
  if (pricePerSecond === null) throw new Error("The exact source-edit price could not be verified. Nothing was spent.");
  const unitCostUsd = pricePerSecond * MOTION_CLIP_SECONDS;
  const estimatedCostUsd = Number((unitCostUsd * itemCount).toFixed(5));
  const maxCostUsd = roundedCeiling(estimatedCostUsd);
  const remainingUsd = await remainingCredits(apiKey);
  return {
    model: model.id,
    modelName: model.name?.replace(/^[^:]+:\s*/i, "") || model.id,
    unitCostUsd,
    preservesSourceAudio: true,
    quote: {
      stage: "motion",
      routeName: "Exact-source visual edit",
      model: model.id,
      modelName: model.name?.replace(/^[^:]+:\s*/i, "") || model.id,
      itemCount,
      unitSeconds: MOTION_CLIP_SECONDS,
      estimatedCostUsd,
      maxCostUsd,
      remainingUsd,
      fundingSufficient: remainingUsd === null ? null : remainingUsd >= maxCostUsd,
      provider: "OpenRouter",
      includes: [
        `${itemCount} independently editable source segments`,
        "Uploaded video supplied as the protected master reference",
        "Original audio retained as a separate protected stem",
        "Zero automatic retries",
      ],
      quotedAt: new Date().toISOString(),
    },
  };
}
