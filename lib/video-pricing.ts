type PriceEntry = { key: string; value: number };

function normalizedEntries(pricing: Record<string, string>): PriceEntry[] {
  return Object.entries(pricing)
    .map(([key, rawValue]) => ({
      key: key.toLowerCase().replace(/[_\s]+/g, "-"),
      value: Number(rawValue),
    }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0);
}

export function selectPricePerSecond(pricing: Record<string, string>): number | null {
  const entries = normalizedEntries(pricing);
  const noAudio = (key: string) => key.includes("no-audio") || key.includes("without-audio");
  const pick = (predicate: (entry: PriceEntry) => boolean) => entries.find(predicate)?.value;

  return (
    pick((entry) => entry.key.includes("720p") && noAudio(entry.key)) ??
    pick((entry) => noAudio(entry.key) && entry.key.includes("video")) ??
    pick((entry) => entry.key === "per-video-second-720p") ??
    pick((entry) => entry.key === "per-video-second") ??
    // OpenRouter's current Video Models API may expose the per-second video SKU as `generate`.
    pick((entry) => entry.key === "generate") ??
    (entries.length === 1 ? entries[0].value : null)
  );
}

type VideoPriceOptions = {
  resolution: "480p" | "720p" | "1080p" | "4K";
  audio: boolean;
  videoInput?: boolean;
};

// OpenRouter exposes some video routes as a direct per-second price and others
// as a price per generated video token. At 24 fps, the published video-token
// rates below reproduce OpenRouter's resolution-tier prices exactly.
const VIDEO_TOKENS_PER_SECOND: Record<VideoPriceOptions["resolution"], number> = {
  "480p": 9_608,
  "720p": 21_600,
  "1080p": 48_600,
  "4K": 194_400,
};

export function selectVideoPricePerSecond(
  pricing: Record<string, string>,
  options: VideoPriceOptions,
): number | null {
  const entries = normalizedEntries(pricing).map((entry) => ({
    ...entry,
    key: entry.key.replace(/:/g, "-"),
  }));
  const resolution = options.resolution.toLowerCase();
  const noAudio = (key: string) => key.includes("no-audio") || key.includes("without-audio");
  const videoInput = (key: string) => key.includes("video-input");
  const perSecond = entries.find((entry) =>
    entry.key.includes("per-video-second") &&
    entry.key.includes(resolution) &&
    (options.videoInput ? videoInput(entry.key) : !videoInput(entry.key)) &&
    (options.audio ? !noAudio(entry.key) : noAudio(entry.key)),
  );
  if (perSecond) return perSecond.value;

  // Newer OpenRouter video routes (for example Wan 3.0) publish their
  // resolution-specific rate as `duration_seconds_720p`. The unit is still
  // USD per generated second, despite the different SKU name.
  const durationSku = entries.find((entry) =>
    entry.key === `duration-seconds-${resolution}` &&
    (options.audio ? !noAudio(entry.key) : noAudio(entry.key)),
  ) ?? (options.audio
    ? entries.find((entry) => entry.key === `duration-seconds-${resolution}`)
    : undefined);
  if (durationSku) return durationSku.value;

  const tokenSku = entries.find((entry) => {
    if (!entry.key.endsWith("video-tokens") &&
        !entry.key.endsWith("video-tokens-without-audio") &&
        !entry.key.endsWith("video-tokens-with-video-input")) return false;
    if (options.videoInput) return entry.key.endsWith("video-tokens-with-video-input");
    if (options.audio) return entry.key.endsWith("video-tokens");
    return entry.key.endsWith("video-tokens-without-audio");
  });
  if (tokenSku) return tokenSku.value * VIDEO_TOKENS_PER_SECOND[options.resolution];

  return selectPricePerSecond(pricing);
}
