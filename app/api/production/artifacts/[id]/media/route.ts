import { and, eq } from "drizzle-orm";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { getDb } from "@/db";
import { productionArtifacts } from "@/db/schema";
import { getBucket } from "@/lib/storage";

function requestedRange(value: string | null, size: number): { offset: number; length: number } | null | "invalid" {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    const length = Math.min(size, suffix);
    return { offset: size - length, length };
  }
  const offset = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(requestedEnd) || offset < 0 || offset >= size || requestedEnd < offset) return "invalid";
  const end = Math.min(size - 1, requestedEnd);
  return { offset, length: end - offset + 1 };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  const { id } = await context.params;
  const [artifact] = await getDb().select().from(productionArtifacts).where(and(
    eq(productionArtifacts.id, id),
    eq(productionArtifacts.ownerEmail, ownerEmail),
  )).limit(1);
  if (!artifact?.objectKey) return new Response("Production artifact is not ready.", { status: 404 });
  const bucket = getBucket();
  const head = await bucket.head(artifact.objectKey);
  const size = head?.size;
  if (!head || typeof size !== "number") return new Response("Production artifact is missing.", { status: 404 });
  const range = requestedRange(request.headers.get("range"), size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const object = await bucket.get(artifact.objectKey, range ? { range } : undefined);
  if (!object) return new Response("Production artifact is missing.", { status: 404 });
  const filename = `${artifact.shotId ?? artifact.kind}-${artifact.id}`;
  const headers: Record<string, string> = {
    "Content-Type": artifact.mimeType || object.httpMetadata?.contentType || head.httpMetadata?.contentType || "application/octet-stream",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    "Content-Length": String(range?.length ?? size),
    ...(object.httpEtag ? { ETag: object.httpEtag } : head.httpEtag ? { ETag: head.httpEtag } : {}),
  };
  if (range) headers["Content-Range"] = `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`;
  return new Response(object.body, {
    status: range ? 206 : 200,
    headers,
  });
}
