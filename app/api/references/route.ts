import { and, desc, eq } from "drizzle-orm";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { getDb } from "@/db";
import { references } from "@/db/schema";
import { sha256Hex } from "@/lib/encoding";
import { getBucket } from "@/lib/storage";
import { activeProject } from "@/lib/projects";

const MAX_FILES = 8;
const MAX_BYTES = 25 * 1024 * 1024;

export async function GET(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
  if (!projectId || !await activeProject(ownerEmail, projectId)) {
    return Response.json({ error: "Choose a project first." }, { status: 400 });
  }
  const rows = await getDb()
    .select()
    .from(references)
    .where(and(eq(references.ownerEmail, ownerEmail), eq(references.projectId, projectId)))
    .orderBy(desc(references.createdAt))
    .limit(40);
  return Response.json({ references: rows });
}

export async function POST(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();

  try {
    const formData = await request.formData();
    const projectId = typeof formData.get("projectId") === "string" ? String(formData.get("projectId")) : "";
    if (!projectId || !await activeProject(ownerEmail, projectId)) {
      return Response.json({ error: "Choose a project before uploading references." }, { status: 400 });
    }
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    if (!files.length) return Response.json({ error: "Add at least one reference." }, { status: 400 });
    if (files.length > MAX_FILES) {
      return Response.json({ error: `A brief can contain up to ${MAX_FILES} references.` }, { status: 400 });
    }

    const accepted = files.filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
    );
    if (accepted.length !== files.length) {
      return Response.json({ error: "References must be images or videos." }, { status: 400 });
    }
    if (accepted.some((file) => file.size > MAX_BYTES)) {
      return Response.json({ error: "Each reference must be 25 MB or smaller." }, { status: 400 });
    }

    const db = getDb();
    const bucket = getBucket();
    const stored = [];
    for (const file of accepted) {
      const bytes = await file.arrayBuffer();
      const id = crypto.randomUUID();
      const safeExtension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
      const objectKey = `references/${ownerEmail}/${projectId}/${id}.${safeExtension}`;
      const sha256 = await sha256Hex(bytes);
      await bucket.put(objectKey, bytes, { httpMetadata: { contentType: file.type } });
      const [row] = await db
        .insert(references)
        .values({
          id,
          ownerEmail,
          projectId,
          objectKey,
          filename: file.name,
          mimeType: file.type,
          byteSize: file.size,
          sha256,
        })
        .returning();
      stored.push(row);
    }
    return Response.json({ references: stored }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reference upload failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
