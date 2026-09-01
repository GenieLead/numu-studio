export const maxDuration = 120;

import { and, eq } from "drizzle-orm";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { getDb } from "@/db";
import { productionArtifacts, productionRuns, productionTasks } from "@/db/schema";
import { getOpenRouterKey, openRouterHeaders } from "@/lib/openrouter-session";
import { ensureProduction, publicProduction, publicTask, refreshProduction } from "@/lib/production-server";
import { getBucket } from "@/lib/storage";
import { mediaWorkerStatus } from "@/lib/media-worker-session";

const TERMINAL = new Set(["completed", "failed", "cancelled", "expired"]);
const MEDIA_DOWNLOAD_TIMEOUT_MS = 45_000;

async function recomputeCost(runId: string): Promise<void> {
  const db = getDb();
  const artifacts = await db.select({ actualCostUsd: productionArtifacts.actualCostUsd })
    .from(productionArtifacts)
    .where(eq(productionArtifacts.runId, runId));
  const total = artifacts.reduce((sum, artifact) => sum + Number(artifact.actualCostUsd ?? 0), 0);
  await db.update(productionRuns).set({ actualCostUsd: total.toFixed(5), updatedAt: new Date().toISOString() })
    .where(eq(productionRuns.id, runId));
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  const { id } = await context.params;
  const db = getDb();
  const [task] = await db.select().from(productionTasks).where(and(
    eq(productionTasks.id, id),
    eq(productionTasks.ownerEmail, ownerEmail),
  )).limit(1);
  if (!task) return Response.json({ error: "Production task not found." }, { status: 404 });
  const [artifactBefore] = await db.select().from(productionArtifacts).where(eq(productionArtifacts.id, task.artifactId)).limit(1);
  let production = await ensureProduction(ownerEmail, task.projectId, task.directionId);
  if (task.pollingUrl === "pending") {
    const pendingSince = Date.parse(task.updatedAt);
    if (Number.isFinite(pendingSince) && Date.now() - pendingSince >= 30_000) {
      const now = new Date().toISOString();
      const error = "The video submission ended before a provider job ID was saved. Its billing state is unknown, so HAYK made no automatic retry. Check OpenRouter activity before preparing a manual retry.";
      await db.update(productionTasks).set({ status: "failed", error, updatedAt: now }).where(and(
        eq(productionTasks.id, id),
        eq(productionTasks.pollingUrl, "pending"),
      ));
      await db.update(productionArtifacts).set({ status: "failed", error, updatedAt: now }).where(and(
        eq(productionArtifacts.id, task.artifactId),
        eq(productionArtifacts.status, "working"),
      ));
      await db.update(productionRuns).set({ status: "stage_failed", error, updatedAt: now }).where(eq(productionRuns.id, task.runId));
      const [updatedTask] = await db.select().from(productionTasks).where(eq(productionTasks.id, id)).limit(1);
      production = await refreshProduction(production);
      return Response.json({ task: publicTask(updatedTask), production: await publicProduction(production, false) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return Response.json({ task: publicTask(task), production: await publicProduction(production, false) }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (TERMINAL.has(task.status) && ["completed", "failed"].includes(artifactBefore?.status ?? "")) {
    return Response.json({ task: publicTask(task), production: await publicProduction(production, false) });
  }
  if (task.pollingUrl === "media-worker") {
    try {
      const poll = await mediaWorkerStatus(task.providerJobId);
      const status = typeof poll.status === "string" ? poll.status : task.status;
      const now = new Date().toISOString();
      if (status === "completed") {
        const [uploaded] = await db.select().from(productionArtifacts).where(eq(productionArtifacts.id, task.artifactId)).limit(1);
        if (uploaded?.status === "completed" && uploaded.objectKey) {
          await db.update(productionTasks).set({ status: "completed", responseJson: JSON.stringify(poll), actualCostUsd: task.maxCostUsd, error: null, updatedAt: now }).where(eq(productionTasks.id, id));
          await db.update(productionArtifacts).set({ actualCostUsd: task.maxCostUsd, error: null, updatedAt: now }).where(eq(productionArtifacts.id, task.artifactId));
          await db.update(productionRuns).set({ status: "stage_ready", error: null, updatedAt: now }).where(eq(productionRuns.id, task.runId));
          await recomputeCost(task.runId);
        } else {
          const message = "The Google worker reported completion without uploading the protected artifact. No retry was made.";
          await db.update(productionTasks).set({ status: "failed", responseJson: JSON.stringify(poll), error: message, updatedAt: now }).where(eq(productionTasks.id, id));
          await db.update(productionArtifacts).set({ status: "failed", error: message, updatedAt: now }).where(eq(productionArtifacts.id, task.artifactId));
          await db.update(productionRuns).set({ status: "stage_failed", error: message, updatedAt: now }).where(eq(productionRuns.id, task.runId));
        }
      } else if (["failed", "cancelled", "expired"].includes(status)) {
        const message = `${typeof poll.error === "string" ? poll.error : `Google worker task ${status}`}. No retry was made.`;
        await db.update(productionTasks).set({ status, responseJson: JSON.stringify(poll), error: message, updatedAt: now }).where(eq(productionTasks.id, id));
        await db.update(productionArtifacts).set({ status: "failed", error: message, updatedAt: now }).where(eq(productionArtifacts.id, task.artifactId));
        await db.update(productionRuns).set({ status: "stage_failed", error: message, updatedAt: now }).where(eq(productionRuns.id, task.runId));
      } else await db.update(productionTasks).set({ status, responseJson: JSON.stringify(poll), error: typeof poll.error === "string" ? poll.error : null, updatedAt: now }).where(eq(productionTasks.id, id));
      const [updatedTask] = await db.select().from(productionTasks).where(eq(productionTasks.id, id)).limit(1);
      production = await refreshProduction(production);
      return Response.json({ task: publicTask(updatedTask), production: await publicProduction(production, false) }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "The Google worker job could not be checked.", task: publicTask(task), production: await publicProduction(production, false) }, { status: 502 });
    }
  }
  const apiKey = await getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "Reconnect OpenRouter to continue checking this shot." }, { status: 409 });
  try {
    const pollingUrl = new URL(task.pollingUrl, "https://openrouter.ai");
    if (pollingUrl.hostname !== "openrouter.ai" || !pollingUrl.pathname.startsWith("/api/v1/videos/")) {
      throw new Error("The provider returned an invalid polling address.");
    }
    const response = await fetch(pollingUrl, { headers: openRouterHeaders(apiKey), cache: "no-store", signal: AbortSignal.timeout(12_000) });
    const text = await response.text();
    let poll: {
      status?: string;
      unsigned_urls?: string[];
      usage?: { cost?: number };
      error?: string | { message?: string };
    } = {};
    try { poll = JSON.parse(text) as typeof poll; } catch { poll = {}; }
    if (!response.ok) throw new Error(`The provider status check failed (${response.status}).`);
    const status = poll.status ?? task.status;
    const actualCost = typeof poll.usage?.cost === "number" ? poll.usage.cost : null;
    const now = new Date().toISOString();
    await db.update(productionTasks).set({
      status: status === "completed" ? "securing" : status,
      actualCostUsd: actualCost === null ? task.actualCostUsd : actualCost.toFixed(5),
      responseJson: JSON.stringify(poll),
      updatedAt: now,
    }).where(eq(productionTasks.id, id));

    if (status === "completed") {
      const contentUrl = poll.unsigned_urls?.[0] ?? `https://openrouter.ai/api/v1/videos/${task.providerJobId}/content?index=0`;
      const parsedContentUrl = new URL(contentUrl, "https://openrouter.ai");
      if (parsedContentUrl.protocol !== "https:") throw new Error("The completed shot returned an invalid media address.");
      const media = await fetch(parsedContentUrl, {
        headers: parsedContentUrl.hostname === "openrouter.ai" ? openRouterHeaders(apiKey) : undefined,
        signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS),
      });
      if (!media.ok) throw new Error(`The completed shot could not be secured (${media.status}).`);
      const bytes = new Uint8Array(await media.arrayBuffer());
      const objectKey = `production/${ownerEmail}/${task.runId}/motion/${task.artifactId}.mp4`;
      const blobResult = await getBucket().put(objectKey, bytes, { httpMetadata: { contentType: media.headers.get("content-type") || "video/mp4" } }) as { url: string } | undefined;
      const storedObjectKey = blobResult?.url ?? objectKey;
      await db.update(productionArtifacts).set({
        status: "completed",
        objectKey: storedObjectKey,
        mimeType: media.headers.get("content-type") || "video/mp4",
        actualCostUsd: (Number(artifactBefore?.actualCostUsd ?? 0) + (actualCost ?? Number(task.maxCostUsd))).toFixed(5),
        error: null,
        updatedAt: now,
      }).where(eq(productionArtifacts.id, task.artifactId));
      await db.update(productionTasks).set({
        status: "completed",
        actualCostUsd: actualCost === null ? task.maxCostUsd : actualCost.toFixed(5),
        error: null,
        updatedAt: now,
      }).where(eq(productionTasks.id, id));
      const motionArtifacts = await db.select().from(productionArtifacts).where(and(
        eq(productionArtifacts.runId, task.runId),
        eq(productionArtifacts.stage, "motion"),
      ));
      const unfinished = motionArtifacts.filter((artifact) => artifact.id !== task.artifactId && artifact.status !== "completed").length;
      await db.update(productionRuns).set({
        status: unfinished ? "generating_motion" : "stage_ready",
        error: null,
        updatedAt: now,
      }).where(eq(productionRuns.id, task.runId));
      await recomputeCost(task.runId);
    } else if (["failed", "cancelled", "expired"].includes(status)) {
      const message = typeof poll.error === "string" ? poll.error : poll.error?.message;
      const error = `${message || `Seedance task ${status}`}. No retry was made.`;
      await db.update(productionTasks).set({ error, updatedAt: now }).where(eq(productionTasks.id, id));
      await db.update(productionArtifacts).set({
        status: "failed",
        error,
        actualCostUsd: actualCost === null ? (artifactBefore?.actualCostUsd ?? null) : (Number(artifactBefore?.actualCostUsd ?? 0) + actualCost).toFixed(5),
        updatedAt: now,
      }).where(eq(productionArtifacts.id, task.artifactId));
      await db.update(productionRuns).set({ status: "stage_failed", error, updatedAt: now }).where(eq(productionRuns.id, task.runId));
      await recomputeCost(task.runId);
    }
    const [updatedTask] = await db.select().from(productionTasks).where(eq(productionTasks.id, id)).limit(1);
    production = await refreshProduction(production);
    return Response.json({ task: publicTask(updatedTask), production: await publicProduction(production, false) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "This shot could not be checked yet.";
    return Response.json({ error: message, task: publicTask(task), production: await publicProduction(production, false) }, { status: 502 });
  }
}
