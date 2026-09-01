import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { references } from "@/db/schema";
import { openOpenRouterKey } from "@/lib/openrouter-session";
import { getBucket } from "@/lib/storage";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return Response.json({ error: "Source token required." }, { status: 401 });
  let grant: { referenceId?: string; ownerEmail?: string; expires?: number };
  try { grant = JSON.parse(await openOpenRouterKey(token)) as typeof grant; } catch { return Response.json({ error: "Invalid source token." }, { status: 401 }); }
  if (grant.referenceId !== id || !grant.ownerEmail || !grant.expires || grant.expires < Date.now()) return Response.json({ error: "Expired source token." }, { status: 401 });
  const [source] = await getDb().select().from(references).where(and(eq(references.id, id), eq(references.ownerEmail, grant.ownerEmail))).limit(1);
  if (!source || !source.mimeType.startsWith("video/")) return Response.json({ error: "Protected video unavailable." }, { status: 404 });
  const object = await getBucket().get(source.objectKey);
  if (!object) return Response.json({ error: "Protected video missing." }, { status: 404 });
  return new Response(object.body, { headers: {
    "Content-Type": source.mimeType, "Content-Length": String(source.byteSize), "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="${source.filename.replace(/[\"\\\r\n]/g, "_")}"`,
  } });
}
