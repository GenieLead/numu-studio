export const MEDIA_WORKER_CONTRACT_VERSION = "numu-media-v1";

export type MediaWorkerCapability =
  | "ffmpeg-conform"
  | "opentimelineio"
  | "aces-ocio"
  | "ebu-r128-mix"
  | "stem-render"
  | "voice-conversion"
  | "performance-lipsync"
  | "prores-422-hq"
  | "h264-review";

export const REQUIRED_MEDIA_WORKER_CAPABILITIES: MediaWorkerCapability[] = [
  "ffmpeg-conform",
  "opentimelineio",
  "aces-ocio",
  "ebu-r128-mix",
  "stem-render",
  "voice-conversion",
  "performance-lipsync",
  "prores-422-hq",
  "h264-review",
];

export type MediaWorkerManifest = {
  contractVersion: typeof MEDIA_WORKER_CONTRACT_VERSION;
  workerVersion: string;
  capabilities: MediaWorkerCapability[];
  color: { config: "ACES 1.3"; workingSpace: "ACEScct" };
  audio: { sampleRate: 48000; stems: ["dialogue", "music", "ambience", "foley", "effects"] };
  codecs: string[];
};

export function verifyMediaWorkerManifest(value: unknown): { ready: boolean; missing: string[]; manifest: MediaWorkerManifest | null } {
  if (!value || typeof value !== "object") return { ready: false, missing: ["valid manifest"], manifest: null };
  const manifest = value as Partial<MediaWorkerManifest>;
  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  const missing = REQUIRED_MEDIA_WORKER_CAPABILITIES.filter((capability) => !capabilities.includes(capability));
  if (manifest.contractVersion !== MEDIA_WORKER_CONTRACT_VERSION) missing.unshift(MEDIA_WORKER_CONTRACT_VERSION as MediaWorkerCapability);
  if (manifest.color?.config !== "ACES 1.3" || manifest.color?.workingSpace !== "ACEScct") missing.push("aces-ocio" as MediaWorkerCapability);
  if (manifest.audio?.sampleRate !== 48000 || manifest.audio?.stems?.join("|") !== "dialogue|music|ambience|foley|effects") missing.push("stem-render" as MediaWorkerCapability);
  return { ready: missing.length === 0, missing, manifest: missing.length ? null : manifest as MediaWorkerManifest };
}

export async function signMediaWorkerPayload(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
