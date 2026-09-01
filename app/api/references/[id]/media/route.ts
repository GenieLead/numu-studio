import { and, eq } from "drizzle-orm";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { getDb } from "@/db";
import { references } from "@/db/schema";
import { getBucket } from "@/lib/storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  const { id } = await context.params;
  const [reference] = await getDb()
    .select()
    .from(references)
    .where(and(eq(references.id, id), eq(references.ownerEmail, ownerEmail)))
    .limit(1);
  if (!reference) return new Response("Reference not found.", { status: 404 });
  const object = await getBucket().get(reference.objectKey);
  if (!object) return new Response("Reference media is unavailable.", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": reference.mimeType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
