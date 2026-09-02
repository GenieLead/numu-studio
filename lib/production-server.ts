import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  directions,
  productionArtifacts,
  productionNodes,
  productionRuns,
  productionTasks,
  references,
} from "@/db/schema";
import type { DirectorCard, ReferenceBinding } from "@/lib/director";
import { getOpenRouterKey } from "@/lib/openrouter-session";
import { omniQuote } from "@/lib/omni-pricing";
import { imageRoute, motionRoute, type ImageRoute } from "@/lib/production-routing";
import { effectiveProductionHardGates, lockSafeProductionShotPlan } from "@/lib/production-guardrails";
import {
  PRODUCTION_PIPELINE_VERSION,
  identityRolesForShot,
  parseBindings,
  parseDirectionCard,
  shotDurationSeconds,
  storyboardPrompt,
  type ProductionArtifactPublic,
  type ProductionQuotePublic,
  type ProductionRunPublic,
  type ProductionStage,
  type ProductionTaskPublic,
} from "@/lib/production-studio";

export type OwnedProduction = {
  direction: typeof directions.$inferSelect;
  card: DirectorCard;
  bindings: ReferenceBinding[];
  referenceRows: Array<typeof references.$inferSelect>;
  run: typeof productionRuns.$inferSelect;
};

const IMAGE_REQUEST_LEASE_MS = 85_000;
const INTERRUPTED_IMAGE_ERROR =
  "The site connection ended before a complete image result was returned. OpenRouter bills image requests only when a final image completes; HAYK recorded no completed result. No automatic retry was made. Use the manual retry control.";

async function persistApprovedImageRoute(
  artifacts: Array<typeof productionArtifacts.$inferSelect>,
  route: ImageRoute,
): Promise<void> {
  const approvedImageRoute = {
    model: route.model,
    modelName: route.modelName,
    endpointUrl: route.endpointUrl,
    providerTag: route.providerTag,
    providerName: route.providerName,
    unitCostUsd: route.unitCostUsd,
  };
  const now = new Date().toISOString();
  for (const artifact of artifacts.filter((candidate) => candidate.status !== "completed")) {
    const artifactMetadata = parseMetadata(artifact.metadataJson);
    if (JSON.stringify(artifactMetadata.approvedImageRoute) === JSON.stringify(approvedImageRoute)) continue;
    await getDb().update(productionArtifacts).set({
      metadataJson: JSON.stringify({ ...artifactMetadata, approvedImageRoute }),
      updatedAt: now,
    }).where(eq(productionArtifacts.id, artifact.id));
  }
}

function numberOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function publicArtifact(artifact: typeof productionArtifacts.$inferSelect): ProductionArtifactPublic {
  return {
    id: artifact.id,
    stage: artifact.stage as ProductionStage,
    kind: artifact.kind,
    shotId: artifact.shotId,
    label: artifact.label,
    status: artifact.status,
    approvalStatus: artifact.approvalStatus,
    orderIndex: artifact.orderIndex,
    mediaUrl: artifact.objectKey ? `/api/production/artifacts/${artifact.id}/media` : null,
    mimeType: artifact.mimeType,
    model: artifact.model,
    metadata: parseMetadata(artifact.metadataJson),
    estimatedCostUsd: numberOrNull(artifact.estimatedCostUsd),
    actualCostUsd: numberOrNull(artifact.actualCostUsd),
    error: artifact.error,
  };
}

export function publicTask(task: typeof productionTasks.$inferSelect): ProductionTaskPublic {
  return {
    id: task.id,
    artifactId: task.artifactId,
    status: task.status,
    model: task.model,
    maxCostUsd: Number(task.maxCostUsd),
    actualCostUsd: numberOrNull(task.actualCostUsd),
    error: task.error,
  };
}

export async function ownedDirection(
  ownerEmail: string,
  projectId: string,
  directionId: string,
): Promise<{ direction: typeof directions.$inferSelect; card: DirectorCard; bindings: ReferenceBinding[]; referenceRows: Array<typeof references.$inferSelect> }> {
  const db = getDb();
  const [direction] = await db.select().from(directions).where(and(
    eq(directions.id, directionId),
    eq(directions.ownerEmail, ownerEmail),
    eq(directions.projectId, projectId),
  )).limit(1);
  if (!direction) throw new Error("Locked direction not found.");
  if (direction.status !== "ready") throw new Error("The director operation is not ready for production.");
  let card = parseDirectionCard(direction.directionJson);
  const bindings = parseBindings(direction.referenceIdsJson);
  const ids = [...new Set(bindings.map((binding) => binding.id))];
  const referenceRows = ids.length
    ? await db.select().from(references).where(and(
        eq(references.ownerEmail, ownerEmail),
        eq(references.projectId, projectId),
        inArray(references.id, ids),
      ))
    : [];
  return { direction, card, bindings, referenceRows };
}

async function insertSourceArtifacts(production: OwnedProduction): Promise<void> {
  const rowById = new Map(production.referenceRows.map((row) => [row.id, row]));
  const now = new Date().toISOString();
  const uniqueBindings = production.bindings.filter((binding, index, all) =>
    all.findIndex((candidate) => candidate.id === binding.id) === index,
  );
  const values: Array<typeof productionArtifacts.$inferInsert> = uniqueBindings.flatMap((binding, index) => {
    const row = rowById.get(binding.id);
    if (!row) return [];
    return [{
      id: crypto.randomUUID(),
      ownerEmail: production.run.ownerEmail,
      projectId: production.run.projectId,
      directionId: production.run.directionId,
      runId: production.run.id,
      stage: "evidence",
      kind: "source_asset",
      shotId: row.id,
      label: row.filename,
      status: "completed",
      approvalStatus: "pending",
      orderIndex: index,
      objectKey: row.objectKey,
      mimeType: row.mimeType,
      metadataJson: JSON.stringify({
        referenceId: row.id,
        role: binding.role,
        durationSeconds: binding.durationSeconds ?? null,
        byteSize: row.byteSize,
        sha256: row.sha256,
        authority: ["product", "character", "location"].includes(binding.role) ? "identity" : "grammar",
      }),
      createdAt: now,
      updatedAt: now,
    }];
  });
  values.push({
    id: crypto.randomUUID(),
    ownerEmail: production.run.ownerEmail,
    projectId: production.run.projectId,
    directionId: production.run.directionId,
    runId: production.run.id,
    stage: "evidence",
    kind: "reference_dossier",
    shotId: "DOSSIER",
    label: "AI reference dossier",
    status: "planned",
    approvalStatus: "pending",
    orderIndex: 10_000,
    model: null,
    metadataJson: JSON.stringify({
      directionAnalysis: production.card.referenceIntelligence,
      analysisPlan: production.card.referenceAnalysis,
      lineage: "Awaiting persisted production analysis",
    }),
    createdAt: now,
    updatedAt: now,
  });
  for (const value of values) {
    await getDb().insert(productionArtifacts).values(value).onConflictDoNothing();
  }
}

export async function ensureProduction(
  ownerEmail: string,
  projectId: string,
  directionId: string,
): Promise<OwnedProduction> {
  const owned = await ownedDirection(ownerEmail, projectId, directionId);
  const db = getDb();
  let [run] = await db.select().from(productionRuns).where(and(
    eq(productionRuns.directionId, directionId),
    eq(productionRuns.ownerEmail, ownerEmail),
    eq(productionRuns.projectId, projectId),
  )).limit(1);
  if (!run) {
    const now = new Date().toISOString();
    const card = owned.card as DirectorCard & { revisionPlan?: unknown; previousDirectionId?: string };
    let inheritedDirectionId = directionId;
    let inheritedRun = null;
    if (card.revisionPlan) {
      const previousDirId = (owned.direction as Record<string, unknown>).previousDirectionId as string | undefined
        ?? card.previousDirectionId;
      if (previousDirId) {
        const [prevRun] = await db.select().from(productionRuns).where(and(
          eq(productionRuns.directionId, previousDirId),
          eq(productionRuns.ownerEmail, ownerEmail),
          eq(productionRuns.projectId, projectId),
        )).limit(1);
        if (prevRun) {
          inheritedRun = prevRun;
          inheritedDirectionId = prevRun.directionId;
        }
      }
      if (!inheritedRun) {
        const allRuns = await db.select().from(productionRuns).where(and(
          eq(productionRuns.ownerEmail, ownerEmail),
          eq(productionRuns.projectId, projectId),
        )).orderBy(desc(productionRuns.createdAt)).limit(5);
        inheritedRun = allRuns[0] ?? null;
        if (inheritedRun) inheritedDirectionId = inheritedRun.directionId;
      }
    }
    if (inheritedRun && inheritedRun.directionId !== directionId) {
      await db.update(productionRuns).set({ directionId, updatedAt: now }).where(eq(productionRuns.id, inheritedRun.id));
      [run] = await db.select().from(productionRuns).where(eq(productionRuns.id, inheritedRun.id)).limit(1);
    } else {
      [run] = await db.insert(productionRuns).values({
        id: crypto.randomUUID(),
        ownerEmail,
        projectId,
        directionId,
        pipelineVersion: PRODUCTION_PIPELINE_VERSION,
        mode: "studio-cut",
        currentStage: "evidence",
        status: "awaiting_evidence",
        actualCostUsd: "0",
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing().returning();
      if (!run) {
        [run] = await db.select().from(productionRuns).where(and(
          eq(productionRuns.directionId, directionId),
          eq(productionRuns.ownerEmail, ownerEmail),
        )).limit(1);
      }
    }
  }
  if (!run) throw new Error("Production could not be initialized.");
  const production: OwnedProduction = { ...owned, run };
  await insertSourceArtifacts(production);
  await ensureProductionGraph(production);
  await reconcileInterruptedImageArtifacts(production);
  await repairPlannedStoryboardArtifacts(production);
  return refreshProduction(production);
}

async function reconcileInterruptedImageArtifacts(production: OwnedProduction): Promise<void> {
  if (!["identity", "storyboard"].includes(production.run.currentStage)) return;
  const db = getDb();
  const working = await db.select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.stage, production.run.currentStage),
    eq(productionArtifacts.status, "working"),
  ));
  const nowMs = Date.now();
  const interruptedAt = new Date(nowMs).toISOString();
  let reconciled = false;
  for (const artifact of working) {
    const updatedAtMs = Date.parse(artifact.updatedAt);
    if (artifact.objectKey || !Number.isFinite(updatedAtMs) || nowMs - updatedAtMs < IMAGE_REQUEST_LEASE_MS) continue;
    const claimed = await db.update(productionArtifacts).set({
      status: "failed",
      error: INTERRUPTED_IMAGE_ERROR,
      metadataJson: JSON.stringify({
        ...parseMetadata(artifact.metadataJson),
        interruptedRequest: true,
        retryUsesExistingApproval: true,
        interruptionKind: "site_request_lease_expired",
        interruptedAt,
      }),
      updatedAt: interruptedAt,
    }).where(and(
      eq(productionArtifacts.id, artifact.id),
      eq(productionArtifacts.status, "working"),
    )).returning({ id: productionArtifacts.id });
    reconciled ||= claimed.length > 0;
  }
  if (reconciled) {
    await db.update(productionRuns).set({
      status: "stage_failed",
      error: INTERRUPTED_IMAGE_ERROR,
      updatedAt: interruptedAt,
    }).where(eq(productionRuns.id, production.run.id));
  }
}

async function repairPlannedStoryboardArtifacts(production: OwnedProduction): Promise<void> {
  if (production.run.currentStage !== "storyboard") return;
  const db = getDb();
  const [artifacts, dossierRows] = await Promise.all([
    db.select().from(productionArtifacts).where(and(
      eq(productionArtifacts.runId, production.run.id),
      eq(productionArtifacts.stage, "storyboard"),
      eq(productionArtifacts.status, "planned"),
    )),
    db.select().from(productionArtifacts).where(and(
      eq(productionArtifacts.runId, production.run.id),
      eq(productionArtifacts.kind, "reference_dossier"),
      eq(productionArtifacts.status, "completed"),
    )).limit(1),
  ]);
  if (!artifacts.length) return;
  const shots = new Map(lockSafeProductionShotPlan(production.card).map((shot) => [shot.id, shot]));
  const dossier = dossierRows[0] ? parseMetadata(dossierRows[0].metadataJson) : null;
  const now = new Date().toISOString();
  for (const artifact of artifacts) {
    const shot = artifact.shotId ? shots.get(artifact.shotId) : null;
    const existing = parseMetadata(artifact.metadataJson);
    const frameType = existing.frameType === "end" ? "end" : existing.frameType === "start" ? "start" : null;
    if (!shot || !frameType) continue;
    const identityRoles = identityRolesForShot(shot);
    const prompt = storyboardPrompt(production.card, shot, frameType, dossier);
    const metadataJson = JSON.stringify({
      ...existing,
      frameType,
      shotTitle: shot.title,
      shotTime: shot.time,
      identityRoles,
      lineage: "canonical identity plates + lock-safe reference grammar → approved keyframe",
      guardrailVersion: "production-locks-v4",
    });
    if (artifact.prompt === prompt && artifact.metadataJson === metadataJson) continue;
    await db.update(productionArtifacts).set({
      prompt,
      metadataJson,
      model: production.run.approvedCostUsd === null ? null : artifact.model,
      estimatedCostUsd: production.run.approvedCostUsd === null ? null : artifact.estimatedCostUsd,
      error: null,
      updatedAt: now,
    }).where(and(eq(productionArtifacts.id, artifact.id), eq(productionArtifacts.status, "planned")));
  }
}

export async function storyboardIdentityReferenceCount(runId: string): Promise<number> {
  const rows = await getDb().select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, runId),
    eq(productionArtifacts.stage, "identity"),
    eq(productionArtifacts.status, "completed"),
  ));
  return rows.filter((artifact) => artifact.objectKey && artifact.mimeType).slice(0, 3).length;
}

async function ensureProductionGraph(production: OwnedProduction): Promise<void> {
  const now = new Date().toISOString();
  const rootId = crypto.randomUUID();
  await getDb().insert(productionNodes).values({
    id: rootId,
    ownerEmail: production.run.ownerEmail,
    projectId: production.run.projectId,
    runId: production.run.id,
    parentId: null,
    level: "film",
    stableKey: "FILM",
    title: production.card.title,
    orderIndex: 0,
    startMs: 0,
    durationMs: Math.round(production.card.deliverySeconds * 1000),
    stateJson: JSON.stringify({ format: production.card.format, pipelineVersion: PRODUCTION_PIPELINE_VERSION }),
    continuityJson: JSON.stringify({ hardGates: effectiveProductionHardGates(production.card), worldLocks: production.card.worldLocks }),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
  const [root] = await getDb().select().from(productionNodes).where(and(
    eq(productionNodes.runId, production.run.id),
    eq(productionNodes.stableKey, "FILM"),
  )).limit(1);
  if (!root) return;
  await getDb().update(productionNodes).set({
    title: production.card.title,
    durationMs: Math.round(production.card.deliverySeconds * 1000),
    stateJson: JSON.stringify({ format: production.card.format, pipelineVersion: PRODUCTION_PIPELINE_VERSION }),
    continuityJson: JSON.stringify({ hardGates: effectiveProductionHardGates(production.card), worldLocks: production.card.worldLocks }),
    updatedAt: now,
  }).where(eq(productionNodes.id, root.id));
  for (const [index, shot] of lockSafeProductionShotPlan(production.card).entries()) {
    const duration = shotDurationSeconds(shot);
    const start = [...shot.time.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))[0] ?? 0;
    await getDb().insert(productionNodes).values({
      id: crypto.randomUUID(),
      ownerEmail: production.run.ownerEmail,
      projectId: production.run.projectId,
      runId: production.run.id,
      parentId: root.id,
      level: "shot",
      stableKey: shot.id,
      title: shot.title,
      orderIndex: index,
      startMs: Math.round(start * 1000),
      durationMs: Math.round(duration * 1000),
      stateJson: JSON.stringify({ action: shot.action, camera: shot.camera, sound: shot.sound }),
      continuityJson: JSON.stringify({ locks: shot.locks }),
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    await getDb().update(productionNodes).set({
      title: shot.title,
      orderIndex: index,
      startMs: Math.round(start * 1000),
      durationMs: Math.round(duration * 1000),
      stateJson: JSON.stringify({ action: shot.action, camera: shot.camera, sound: shot.sound }),
      continuityJson: JSON.stringify({ locks: shot.locks }),
      updatedAt: now,
    }).where(and(eq(productionNodes.runId, production.run.id), eq(productionNodes.stableKey, shot.id)));
  }
}

export async function stageQuote(production: OwnedProduction): Promise<ProductionQuotePublic | null> {
  const stage = production.run.currentStage as ProductionStage;
  if (stage === "score") return {
    stage, routeName: "Original score · separately approved", model: "lyria-3-clip-preview", modelName: "Lyria 3 Clip",
    itemCount: 1, unitSeconds: 30, estimatedCostUsd: 0.04, maxCostUsd: 0.04, remainingUsd: null, fundingSufficient: null,
    provider: "Google Cloud", includes: ["30-second high-fidelity score", "playable WAV artifact", "no automatic retry"], quotedAt: new Date().toISOString(),
  };
  if (!(["identity", "storyboard", "motion"] as ProductionStage[]).includes(stage)) return null;
  const artifacts = await getDb().select().from(productionArtifacts).where(and(
    eq(productionArtifacts.runId, production.run.id),
    eq(productionArtifacts.stage, stage),
  ));
  const remaining = artifacts.filter((artifact) => artifact.status !== "completed").length;
  if (remaining === 0) return null;
  const containsSourceEdit = artifacts.some((artifact) => {
    const contract = parseMetadata(artifact.metadataJson).routeContract;
    return contract && typeof contract === "object" && (contract as Record<string, unknown>).mode === "source_edit";
  });
  if (containsSourceEdit) return omniQuote(remaining, 4);
  const apiKey = await getOpenRouterKey();
  if (!apiKey) throw new Error("Reconnect OpenRouter to verify this stage's live route and exact ceiling.");
  if (stage === "identity") {
    const route = await imageRoute(apiKey, "identity", remaining, 1);
    if (production.run.approvedCostUsd !== null) await persistApprovedImageRoute(artifacts, route);
    return route.quote;
  }
  if (stage === "storyboard") {
    const referenceCount = await storyboardIdentityReferenceCount(production.run.id);
    if (!referenceCount) throw new Error("The approved canonical identity plates are missing. Nothing was spent.");
    const route = await imageRoute(apiKey, "storyboard", remaining, referenceCount);
    if (production.run.approvedCostUsd !== null) await persistApprovedImageRoute(artifacts, route);
    return route.quote;
  }
  return (await motionRoute(apiKey, remaining)).quote;
}

export async function publicProduction(production: OwnedProduction, includeQuote = true): Promise<ProductionRunPublic> {
  const db = getDb();
  const [artifacts, tasks] = await Promise.all([
    db.select().from(productionArtifacts).where(eq(productionArtifacts.runId, production.run.id)).orderBy(asc(productionArtifacts.orderIndex), asc(productionArtifacts.createdAt)),
    db.select().from(productionTasks).where(eq(productionTasks.runId, production.run.id)).orderBy(asc(productionTasks.createdAt)),
  ]);
  let quote: ProductionQuotePublic | null = null;
  if (includeQuote) quote = await stageQuote(production);
  return {
    id: production.run.id,
    directionId: production.run.directionId,
    projectId: production.run.projectId,
    pipelineVersion: production.run.pipelineVersion,
    mode: production.run.mode,
    currentStage: production.run.currentStage as ProductionStage,
    status: production.run.status,
    estimatedCostUsd: numberOrNull(production.run.estimatedCostUsd),
    approvedCostUsd: numberOrNull(production.run.approvedCostUsd),
    actualCostUsd: Number(production.run.actualCostUsd),
    error: production.run.error,
    artifacts: artifacts.map(publicArtifact),
    tasks: tasks.map(publicTask),
    quote,
  };
}

export async function refreshProduction(production: OwnedProduction): Promise<OwnedProduction> {
  const [run] = await getDb().select().from(productionRuns).where(eq(productionRuns.id, production.run.id)).limit(1);
  if (!run) throw new Error("Production run not found.");
  return { ...production, run };
}
