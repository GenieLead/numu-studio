import { and, eq } from "drizzle-orm";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { getDb } from "@/db";
import { productionArtifacts } from "@/db/schema";
import { ensureProduction, publicProduction, refreshProduction } from "@/lib/production-server";
import { getBucket } from "@/lib/storage";

const MAX_CLIP_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["video/webm", "video/mp4"]);

export async function POST(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? "";
    const directionId = url.searchParams.get("directionId") ?? "";
    const sourceId = url.searchParams.get("sourceId") ?? "";
    const durationSeconds = Number(url.searchParams.get("durationSeconds") ?? 0);
    if (!projectId || !directionId || !sourceId || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 30) {
      return Response.json({ error: "The bounded evidence clip is incomplete." }, { status: 400 });
    }
    const production = await ensureProduction(ownerEmail, projectId, directionId);
    if (production.run.currentStage !== "evidence") {
      return Response.json({ error: "Reference evidence is already protected for this run." }, { status: 409 });
    }
    const source = production.referenceRows.find((row) => row.id === sourceId && row.mimeType.startsWith("video/"));
    const binding = production.bindings.find((candidate) => candidate.id === sourceId && ["style", "motion", "raw", "patch"].includes(candidate.role));
    if (!source || !binding) return Response.json({ error: "The evidence source does not belong to this project." }, { status: 404 });
    const contentType = (request.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) return Response.json({ error: "The browser produced an unsupported evidence-clip format." }, { status: 415 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_CLIP_BYTES) return Response.json({ error: "The bounded evidence clip exceeded its local-analysis limit." }, { status: 413 });

    const db = getDb();
    const [existing] = await db.select().from(productionArtifacts).where(and(
      eq(productionArtifacts.runId, production.run.id),
      eq(productionArtifacts.kind, "reference_clip"),
      eq(productionArtifacts.shotId, sourceId),
    )).limit(1);
    if (existing?.objectKey) await getBucket().delete(existing.objectKey);
    const id = existing?.id ?? crypto.randomUUID();
    const extension = contentType === "video/mp4" ? "mp4" : "webm";
    const objectKey = `production/${ownerEmail}/${production.run.id}/evidence/${id}.${extension}`;
    const blobResult = await getBucket().put(objectKey, bytes, { httpMetadata: { contentType } }) as { url: string } | undefined;
    const storedObjectKey = blobResult?.url ?? objectKey;
    const now = new Date().toISOString();
    const values = {
      ownerEmail,
      projectId,
      directionId,
      runId: production.run.id,
      stage: "evidence",
      kind: "reference_clip",
      shotId: sourceId,
      label: `${durationSeconds.toFixed(1)}s audiovisual evidence window`,
      status: "completed",
      approvalStatus: "pending",
      orderIndex: 9000,
      objectKey: storedObjectKey,
      mimeType: contentType,
      metadataJson: JSON.stringify({
        sourceId,
        sourceFilename: source.filename,
        sourceDurationSeconds: binding.durationSeconds ?? null,
        windowStartSeconds: 0,
        windowDurationSeconds: Number(durationSeconds.toFixed(2)),
        extraction: "on-device bounded audiovisual transcode",
        fullSourceUploadedToAnalysis: false,
      }),
      updatedAt: now,
    };
    if (existing) {
      await db.update(productionArtifacts).set(values).where(eq(productionArtifacts.id, existing.id));
    } else {
      await db.insert(productionArtifacts).values({ id, ...values, createdAt: now });
    }
    const refreshed = await refreshProduction(production);
    return Response.json({ production: await publicProduction(refreshed, false) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The bounded evidence clip could not be secured.";
    return Response.json({ error: message }, { status: 409 });
  }
}
