import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { productionArtifacts, productionRuns } from "@/db/schema";
import { openOpenRouterKey } from "@/lib/openrouter-session";
import { getBucket } from "@/lib/storage";

type ArtifactGrant = {
  artifactId?: string;
  expires?: number;
  mimeType?: string;
  purpose?: "provider_input" | "worker_output";
};

async function artifactGrant(request: Request, id: string): Promise<ArtifactGrant | null> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return null;
  try {
    const grant = JSON.parse(await openOpenRouterKey(token)) as ArtifactGrant;
    return grant.artifactId === id && Boolean(grant.expires) && grant.expires! >= Date.now() ? grant : null;
  } catch {
    return null;
  }
}

/**
 * Gives an explicitly authorized provider a short-lived, directly downloadable
 * HTTPS input. Video providers are not sent multi-megabyte data URLs and the
 * protected object remains private outside this encrypted, expiring grant.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const grant = await artifactGrant(request, id);
  if (!grant || grant.purpose !== "provider_input") return Response.json({ error: "Valid provider-input token required." }, { status: 401 });
  const [artifact] = await getDb().select().from(productionArtifacts).where(eq(productionArtifacts.id, id)).limit(1);
  if (!artifact?.objectKey || artifact.status !== "completed") return Response.json({ error: "Protected provider input unavailable." }, { status: 404 });
  const object = await getBucket().get(artifact.objectKey);
  if (!object) return Response.json({ error: "Protected provider input missing." }, { status: 404 });
  return new Response(object.body, { headers: {
    "Content-Type": artifact.mimeType || object.httpMetadata?.contentType || "application/octet-stream",
    ...(typeof object.size === "number" ? { "Content-Length": String(object.size) } : {}),
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="${artifact.id}"`,
  } });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const grant = await artifactGrant(request, id);
  if (!grant || (grant.purpose && grant.purpose !== "worker_output")) return Response.json({ error: "Valid worker-output token required." }, { status: 401 });
  const [artifact] = await getDb().select().from(productionArtifacts).where(eq(productionArtifacts.id, id)).limit(1);
  if (!artifact || !["planned", "working"].includes(artifact.status)) return Response.json({ error: "Artifact slot unavailable." }, { status: 409 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > 500 * 1024 * 1024) return Response.json({ error: "Artifact size rejected." }, { status: 413 });
  const mimeType = grant.mimeType || request.headers.get("content-type") || "application/octet-stream";
  const extension = mimeType.startsWith("audio/") ? "wav" : mimeType.startsWith("video/") ? "mp4" : "bin";
  const objectKey = `production/${artifact.ownerEmail}/${artifact.runId}/${artifact.stage}/${artifact.id}.${extension}`;
  const blobResult = await getBucket().put(objectKey, bytes, { httpMetadata: { contentType: mimeType } }) as { url: string } | undefined;
  const storedObjectKey = blobResult?.url ?? objectKey;
  const now = new Date().toISOString();
  await getDb().update(productionArtifacts).set({ status: "completed", objectKey: storedObjectKey, mimeType, error: null, updatedAt: now }).where(eq(productionArtifacts.id, id));
  await getDb().update(productionRuns).set({ status: "stage_ready", error: null, updatedAt: now }).where(eq(productionRuns.id, artifact.runId));
  return Response.json({ stored: true });
}
