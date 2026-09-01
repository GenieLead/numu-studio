import { cookies } from "next/headers";
import { openOpenRouterKey } from "@/lib/openrouter-session";

export const SYNC_API_KEY_COOKIE = "numu_sync_api_key";

export async function getSyncApiKey(): Promise<string | null> {
  const sealed = (await cookies()).get(SYNC_API_KEY_COOKIE)?.value;
  if (!sealed) return null;
  try { return await openOpenRouterKey(sealed); } catch { return null; }
}

export async function syncRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const key = await getSyncApiKey();
  if (!key) throw new Error("Connect Sync Labs before performance lip-sync.");
  return fetch(`https://api.sync.so${path}`, {
    ...init,
    headers: { "x-api-key": key, Accept: "application/json", ...(init.headers ?? {}) },
  });
}
