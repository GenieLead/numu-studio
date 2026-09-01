import { and, eq } from "drizzle-orm";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { getDb } from "@/db";
import { productionArtifacts, productionRuns } from "@/db/schema";
import { ensureProduction, publicProduction, refreshProduction } from "@/lib/production-server";
import { getBucket } from "@/lib/storage";

const MAX_MASTER_BYTES = 35 * 1024 * 1024;

export async function POST(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  try {
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId") ?? "";
    const projectId = url.searchParams.get("projectId") ?? "";
    const directionId = url.searchParams.get("directionId") ?? "";
    if (!runId || !projectId || !directionId) return Response.json({ error: "The assembly target is incomplete." }, { status: 400 });
    let production = await ensureProduction(ownerEmail, projectId, directionId);
    if (production.run.id !== runId || production.run.currentStage !== "conform") {
      return Response.json({ error: "This run is not ready for final test-video assembly." }, { status: 409 });
    }
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_MASTER_BYTES) return Response.json({ error: "The assembled final test video exceeded 35 MB." }, { status: 413 });
    const mimeType = (request.headers.get("content-type") || "video/webm").split(";")[0].trim().toLowerCase();
    if (!new Set(["video/webm", "video/mp4"]).has(mimeType)) return Response.json({ error: "The assembled final test video must be WebM or MP4." }, { status: 415 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_MASTER_BYTES) return Response.json({ error: "The assembled final test video was empty or too large." }, { status: 413 });
    const db = getDb();
    const [artifact] = await db.select().from(productionArtifacts).where(and(
      eq(productionArtifacts.runId, runId),
      eq(productionArtifacts.kind, "review_cut"),
    )).limit(1);
    if (!artifact) return Response.json({ error: "The final test-video artifact is missing." }, { status: 404 });
    const extension = mimeType === "video/mp4" ? "mp4" : "webm";
    const objectKey = `production/${ownerEmail}/${runId}/conform/${artifact.id}.${extension}`;
    const blobResult = await getBucket().put(objectKey, bytes, { httpMetadata: { contentType: mimeType } }) as { url: string } | undefined;
    const storedObjectKey = blobResult?.url ?? objectKey;
    const now = new Date().toISOString();
    const previousMetadata = (() => { try { return JSON.parse(artifact.metadataJson) as Record<string, unknown>; } catch { return {}; } })();
    await db.update(productionArtifacts).set({
      status: "completed",
      objectKey: storedObjectKey,
      mimeType,
      actualCostUsd: "0",
      metadataJson: JSON.stringify({
        ...previousMetadata,
        assembledAt: now,
        byteSize: bytes.byteLength,
        container: extension,
        apiSpendUsd: 0,
      }),
      updatedAt: now,
    }).where(eq(productionArtifacts.id, artifact.id));
    await db.update(productionRuns).set({ status: "stage_ready", error: null, updatedAt: now }).where(eq(productionRuns.id, runId));
    production = await refreshProduction(production);
    return Response.json({ production: await publicProduction(production, false) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The assembled final test video could not be secured.";
    return Response.json({ error: message }, { status: 409 });
  }
}
