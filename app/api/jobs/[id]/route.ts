import { and, eq } from "drizzle-orm";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { getDb } from "@/db";
import { jobs } from "@/db/schema";
import { sha256Hex } from "@/lib/encoding";
import { getOpenRouterKey, openRouterHeaders } from "@/lib/openrouter-session";
import { getBucket } from "@/lib/storage";

const TERMINAL_FAILURES = new Set(["failed", "cancelled", "expired"]);

function publicJob(job: typeof jobs.$inferSelect) {
  return {
    id: job.id,
    status: job.status,
    model: job.model,
    maxCostUsd: Number(job.maxCostUsd),
    actualCostUsd: job.actualCostUsd ? Number(job.actualCostUsd) : null,
    error: job.error,
    ready: Boolean(job.outputObjectKey),
    mediaUrl: job.outputObjectKey ? `/api/jobs/${job.id}/media` : null,
    providerAccepted: job.providerJobId !== "pending",
    usageReported: job.actualCostUsd !== null,
    canRetry: TERMINAL_FAILURES.has(job.status) && !job.outputObjectKey,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  const { id } = await context.params;
  const db = getDb();
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.ownerEmail, ownerEmail)))
    .limit(1);
  if (!job) return Response.json({ error: "Generation not found." }, { status: 404 });
  if (job.outputObjectKey || TERMINAL_FAILURES.has(job.status) || job.pollingUrl === "pending") {
    return Response.json({ job: publicJob(job) });
  }

  const apiKey = await getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "Reconnect OpenRouter to continue checking the job." }, { status: 409 });

  try {
    const pollingUrl = new URL(job.pollingUrl, "https://openrouter.ai");
    if (pollingUrl.hostname !== "openrouter.ai" || !pollingUrl.pathname.startsWith("/api/v1/videos/")) {
      throw new Error("The provider polling address failed validation.");
    }
    const pollResponse = await fetch(pollingUrl, { headers: openRouterHeaders(apiKey) });
    if (!pollResponse.ok) throw new Error(`Provider status check failed (${pollResponse.status}).`);
    const poll = (await pollResponse.json()) as {
      id?: string;
      status?: string;
      unsigned_urls?: string[];
      usage?: { cost?: number };
      error?: unknown;
    };
    const status = poll.status ?? job.status;
    const actualCost = typeof poll.usage?.cost === "number" ? poll.usage.cost.toFixed(4) : job.actualCostUsd;

    if (TERMINAL_FAILURES.has(status)) {
      const error = typeof poll.error === "string" ? poll.error : `Generation ${status}.`;
      await db
        .update(jobs)
        .set({ status, actualCostUsd: actualCost, error, responseJson: JSON.stringify(poll), updatedAt: new Date().toISOString() })
        .where(eq(jobs.id, id));
    } else if (status === "completed") {
      const contentUrl = poll.unsigned_urls?.[0] ?? `https://openrouter.ai/api/v1/videos/${job.providerJobId}/content?index=0`;
      const parsedContentUrl = new URL(contentUrl, "https://openrouter.ai");
      const download = await fetch(parsedContentUrl, {
        headers: parsedContentUrl.hostname === "openrouter.ai" ? openRouterHeaders(apiKey) : undefined,
      });
      if (!download.ok) throw new Error(`Completed video download failed (${download.status}).`);
      const bytes = await download.arrayBuffer();
      const outputObjectKey = `outputs/${ownerEmail}/${job.id}/provider-original.mp4`;
      const outputSha256 = await sha256Hex(bytes);
      await getBucket().put(outputObjectKey, bytes, { httpMetadata: { contentType: "video/mp4" } });
      await db
        .update(jobs)
        .set({
          status,
          actualCostUsd: actualCost,
          responseJson: JSON.stringify(poll),
          outputObjectKey,
          outputSha256,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(jobs.id, id));
    } else {
      await db
        .update(jobs)
        .set({ status, actualCostUsd: actualCost, responseJson: JSON.stringify(poll), updatedAt: new Date().toISOString() })
        .where(eq(jobs.id, id));
    }

    const [updated] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    return Response.json({ job: publicJob(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Status check failed.";
    return Response.json({ error: message, job: publicJob(job) }, { status: 502 });
  }
}
