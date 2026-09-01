import type { ProductionQuotePublic } from "@/lib/production-studio";

export const OMNI_MODEL = "gemini-omni-1.1-flash-preview";
export const OMNI_RESOLUTION = "1080p" as const;

// Google list pricing: 5,792 input video tokens/s at $1.50/M and
// 8,688 1080p output video tokens/s at $17.50/M.
const INPUT_COST_PER_SECOND = (5_792 * 1.5) / 1_000_000;
const OUTPUT_COST_PER_SECOND_1080P = (8_688 * 17.5) / 1_000_000;

export function omniUnitCost(seconds: number): number {
  return Number(((INPUT_COST_PER_SECOND + OUTPUT_COST_PER_SECOND_1080P) * seconds).toFixed(5));
}

export function omniQuote(itemCount: number, secondsPerItem: number): ProductionQuotePublic {
  const unitCost = omniUnitCost(secondsPerItem);
  const estimated = Number((unitCost * itemCount).toFixed(5));
  const ceiling = Number((Math.ceil((estimated - Number.EPSILON) * 100) / 100).toFixed(2));
  return {
    stage: "motion", routeName: "Protected source edit · separately approved", model: OMNI_MODEL,
    modelName: "Gemini Omni 1.1 Flash", itemCount, unitSeconds: secondsPerItem,
    estimatedCostUsd: estimated, maxCostUsd: ceiling, remainingUsd: null, fundingSufficient: null,
    provider: "Google Cloud",
    includes: ["1080p source-preserving video edit", "private source and result transfer", "original audio retained for conform", "no automatic retry"],
    quotedAt: new Date().toISOString(),
  };
}
