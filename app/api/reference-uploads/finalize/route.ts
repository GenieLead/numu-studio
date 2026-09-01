import { and, eq } from "drizzle-orm";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { getDb } from "@/db";
import { references } from "@/db/schema";
import { sha256Hex } from "@/lib/encoding";
import {
  REFERENCE_UPLOAD_ID_PATTERN,
} from "@/lib/reference-uploads";
import { getBucket } from "@/lib/storage";
import { activeProject } from "@/lib/projects";

const MAX_BYTES = 25 * 1024 * 1024;

type FinalizeBody = {
  projectId?: unknown;
  uploadId?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  byteSize?: unknown;
  totalParts?: unknown;
};

function safeFilename(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 240) || "reference";
}

export async function POST(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();

  try {
    const body = (await request.json()) as FinalizeBody;
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
    const filename = typeof body.filename === "string" ? safeFilename(body.filename) : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
    const byteSize = Number(body.byteSize);
    const totalParts = Number(body.totalParts);

    if (!projectId || !await activeProject(ownerEmail, projectId)) {
      return Response.json({ error: "Choose a project before uploading references." }, { status: 400 });
    }
    if (!REFERENCE_UPLOAD_ID_PATTERN.test(uploadId)) {
      return Response.json({ error: "The reference upload identifier is invalid." }, { status: 400 });
    }
    if (!filename || (!mimeType.startsWith("image/") && !mimeType.startsWith("video/") && !mimeType.startsWith("audio/"))) {
      return Response.json({ error: "References must be named images, videos or audio files." }, { status: 400 });
    }
    if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_BYTES) {
      return Response.json({ error: "Each reference must be 25 MB or smaller." }, { status: 400 });
    }

    const expectedParts = Math.ceil(byteSize / (1024 * 1024));
    if (!Number.isInteger(totalParts) || totalParts !== expectedParts) {
      return Response.json({ error: "The reference upload is incomplete." }, { status: 400 });
    }

    const bucket = getBucket();
    const prefix = `reference-parts/${ownerEmail}/${uploadId}/`;
    const parts = await bucket.listByPrefix(prefix);

    if (parts.length === 0) {
      return Response.json({ error: "Reference upload parts are missing. Please try uploading again." }, { status: 400 });
    }

    parts.sort((a, b) => {
      const aIdx = parseInt(a.key.split("/").pop() ?? "0", 10);
      const bIdx = parseInt(b.key.split("/").pop() ?? "0", 10);
      return aIdx - bIdx;
    });

    const assembled = new Uint8Array(byteSize);
    let offset = 0;

    for (const part of parts) {
      const object = await bucket.get(part.url);
      if (!object) {
        return Response.json({ error: `Reference upload part could not be read.` }, { status: 400 });
      }
      const partData = new Uint8Array(await new Response(object.body).arrayBuffer());
      if (!partData.byteLength || offset + partData.byteLength > byteSize) {
        return Response.json({ error: "The uploaded reference size did not match the original file." }, { status: 400 });
      }
      assembled.set(partData, offset);
      offset += partData.byteLength;
    }

    if (offset !== byteSize) {
      return Response.json({ error: "The uploaded reference is incomplete." }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const safeExtension = filename.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
    const objectKey = `references/${ownerEmail}/${projectId}/${id}.${safeExtension}`;
    const sha256 = await sha256Hex(assembled);

    const [existing] = await getDb()
      .select()
      .from(references)
      .where(and(
        eq(references.ownerEmail, ownerEmail),
        eq(references.projectId, projectId),
        eq(references.sha256, sha256),
      ))
      .limit(1);
    if (existing) {
      await Promise.allSettled(parts.map((p) => bucket.delete(p.url)));
      return Response.json({ reference: existing, reused: true }, { status: 200 });
    }

    const blobResult = await bucket.put(objectKey, assembled, { httpMetadata: { contentType: mimeType } }) as { url: string } | undefined;
    const storedObjectKey = blobResult?.url ?? objectKey;

    const [row] = await getDb()
      .insert(references)
      .values({
        id,
        ownerEmail,
        projectId,
        objectKey: storedObjectKey,
        filename,
        mimeType,
        byteSize,
        sha256,
      })
      .returning();

    await Promise.allSettled(parts.map((p) => bucket.delete(p.url)));
    return Response.json({ reference: row }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reference upload could not be completed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
