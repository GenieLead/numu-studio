import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import {
  MAX_REFERENCE_PARTS,
  REFERENCE_CHUNK_BYTES,
  REFERENCE_UPLOAD_ID_PATTERN,
  referencePartKey,
} from "@/lib/reference-uploads";
import { getBucket } from "@/lib/storage";

export async function POST(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();

  const url = new URL(request.url);
  const uploadId = url.searchParams.get("uploadId") ?? "";
  const partIndex = Number(url.searchParams.get("part"));

  if (!REFERENCE_UPLOAD_ID_PATTERN.test(uploadId)) {
    return Response.json({ error: "The reference upload identifier is invalid." }, { status: 400 });
  }
  if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= MAX_REFERENCE_PARTS) {
    return Response.json({ error: "The reference upload part is invalid." }, { status: 400 });
  }

  const statedLength = Number(request.headers.get("content-length") ?? 0);
  if (statedLength > REFERENCE_CHUNK_BYTES) {
    return Response.json({ error: "A reference upload part exceeded 1 MB." }, { status: 413 });
  }

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > REFERENCE_CHUNK_BYTES) {
    return Response.json({ error: "A reference upload part must be between 1 byte and 1 MB." }, { status: 400 });
  }

  await getBucket().put(referencePartKey(ownerEmail, uploadId, partIndex), bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
  });

  return Response.json({ uploaded: true, part: partIndex }, { status: 201 });
}
