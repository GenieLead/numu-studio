import { cookies } from "next/headers";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { sealOpenRouterKey } from "@/lib/openrouter-session";
import { getSyncApiKey, SYNC_API_KEY_COOKIE } from "@/lib/sync-session";

const cookieOptions = { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/", maxAge: 60 * 60 * 24 * 30 };

async function verify(key: string) {
  const response = await fetch("https://api.sync.so/v2/models", { headers: { "x-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(response.status === 401 ? "Sync Labs rejected this API key." : `Sync Labs verification failed (${response.status}).`);
  return { connected: true, model: "sync-3", freeGenerationsDeclared: 3 };
}

export async function GET() {
  if (!await apiUserEmail()) return unauthorized();
  const key = await getSyncApiKey();
  if (!key) return Response.json({ connected: false });
  try { return Response.json(await verify(key), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ connected: false, error: error instanceof Error ? error.message : "Sync Labs is unavailable." }, { headers: { "Cache-Control": "private, no-store" } }); }
}

export async function POST(request: Request) {
  if (!await apiUserEmail()) return unauthorized();
  const body = await request.json().catch(() => null) as { apiKey?: string } | null;
  const key = body?.apiKey?.trim();
  if (!key || key.length < 20) return Response.json({ error: "Enter the complete Sync Labs API key." }, { status: 400 });
  try {
    const status = await verify(key);
    (await cookies()).set(SYNC_API_KEY_COOKIE, await sealOpenRouterKey(key), cookieOptions);
    return Response.json(status);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Sync Labs could not be connected." }, { status: 400 }); }
}

export async function DELETE() {
  if (!await apiUserEmail()) return unauthorized();
  (await cookies()).delete(SYNC_API_KEY_COOKIE);
  return Response.json({ disconnected: true });
}
