import { cookies } from "next/headers";
import { openOpenRouterKey } from "@/lib/openrouter-session";
import { signMediaWorkerPayload } from "@/lib/media-worker-contract";

export const MEDIA_WORKER_URL_COOKIE = "numu_media_worker_url";
export const MEDIA_WORKER_SECRET_COOKIE = "numu_media_worker_secret";

export async function getMediaWorkerConnection(): Promise<{ url: string; secret: string } | null> {
  const store = await cookies();
  const url = store.get(MEDIA_WORKER_URL_COOKIE)?.value;
  const sealedSecret = store.get(MEDIA_WORKER_SECRET_COOKIE)?.value;
  if (!url || !sealedSecret) return null;
  try {
    return { url: url.replace(/\/$/, ""), secret: await openOpenRouterKey(sealedSecret) };
  } catch {
    return null;
  }
}

export async function submitMediaWorkerJob(payload: Record<string, unknown>): Promise<{ id: string; status: string; progress?: number; phase?: string }> {
  const connection = await getMediaWorkerConnection();
  if (!connection) throw new Error("Connect the Google media worker before starting this department.");
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await signMediaWorkerPayload(connection.secret, timestamp, body);
  const response = await fetch(`${connection.url}/v1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-HAYK-Timestamp": timestamp, "X-HAYK-Signature": signature },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let result: { id?: string; status?: string; progress?: number; phase?: string; detail?: string } = {};
  try { result = JSON.parse(text) as typeof result; } catch { result = {}; }
  if (!response.ok || !result.id) throw new Error(result.detail || `Google worker rejected the job (${response.status}).`);
  return { id: result.id, status: result.status ?? "queued", progress: result.progress, phase: result.phase };
}

export async function mediaWorkerStatus(jobId: string): Promise<Record<string, unknown>> {
  const connection = await getMediaWorkerConnection();
  if (!connection) throw new Error("Reconnect the Google media worker to inspect this job.");
  const response = await fetch(`${connection.url}/v1/jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : `Worker status failed (${response.status}).`);
  return payload;
}
