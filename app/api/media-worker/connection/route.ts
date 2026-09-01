import { cookies } from "next/headers";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { openOpenRouterKey, sealOpenRouterKey } from "@/lib/openrouter-session";
import { verifyMediaWorkerManifest } from "@/lib/media-worker-contract";
import { MEDIA_WORKER_SECRET_COOKIE, MEDIA_WORKER_URL_COOKIE } from "@/lib/media-worker-session";

const URL_COOKIE = MEDIA_WORKER_URL_COOKIE;
const SECRET_COOKIE = MEDIA_WORKER_SECRET_COOKIE;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

async function inspectWorker(url: string) {
  const response = await fetch(`${url.replace(/\/$/, "")}/health`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Worker health check failed (${response.status}).`);
  const manifest = await response.json();
  const verification = verifyMediaWorkerManifest(manifest);
  const capabilities = Array.isArray((manifest as { capabilities?: unknown }).capabilities)
    ? (manifest as { capabilities: string[] }).capabilities
    : [];
  return {
    online: true,
    productionReady: verification.ready,
    workerVersion: typeof (manifest as { workerVersion?: unknown }).workerVersion === "string"
      ? (manifest as { workerVersion: string }).workerVersion
      : null,
    capabilities,
    missing: verification.missing,
  };
}

export async function GET() {
  if (!await apiUserEmail()) return unauthorized();
  const store = await cookies();
  const url = store.get(URL_COOKIE)?.value;
  const sealedSecret = store.get(SECRET_COOKIE)?.value;
  if (!url || !sealedSecret) return Response.json({ configured: false, online: false, productionReady: false });
  try {
    await openOpenRouterKey(sealedSecret);
    return Response.json({ configured: true, url, ...(await inspectWorker(url)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({
      configured: true,
      url,
      online: false,
      productionReady: false,
      error: error instanceof Error ? error.message : "The worker could not be reached.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function POST(request: Request) {
  if (!await apiUserEmail()) return unauthorized();
  const body = await request.json().catch(() => null) as { url?: string; secret?: string } | null;
  const secret = body?.secret?.trim();
  let url: URL;
  try {
    url = new URL(body?.url?.trim() ?? "");
  } catch {
    return Response.json({ error: "Enter the complete HTTPS worker URL." }, { status: 400 });
  }
  if (url.protocol !== "https:" || !secret || secret.length < 24) {
    return Response.json({ error: "A valid HTTPS worker URL and connection secret are required." }, { status: 400 });
  }
  const normalizedUrl = url.toString().replace(/\/$/, "");
  try {
    const status = await inspectWorker(normalizedUrl);
    const store = await cookies();
    store.set(URL_COOKIE, normalizedUrl, cookieOptions());
    store.set(SECRET_COOKIE, await sealOpenRouterKey(secret), cookieOptions());
    return Response.json({ configured: true, url: normalizedUrl, ...status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The worker could not be reached." }, { status: 400 });
  }
}

export async function DELETE() {
  if (!await apiUserEmail()) return unauthorized();
  const store = await cookies();
  store.delete(URL_COOKIE);
  store.delete(SECRET_COOKIE);
  return Response.json({ disconnected: true });
}
