import { and, eq } from "drizzle-orm";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { getDb } from "@/db";
import { jobs } from "@/db/schema";
import { getBucket } from "@/lib/storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  const { id } = await context.params;
  const [job] = await getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.ownerEmail, ownerEmail)))
    .limit(1);
  if (!job?.outputObjectKey) return new Response("Video is not ready.", { status: 404 });
  const object = await getBucket().get(job.outputObjectKey);
  if (!object) return new Response("Stored video is unavailable.", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "video/mp4",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="numu-${job.id}.mp4"`,
    },
  });
}
