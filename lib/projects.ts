import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  directions,
  jobs,
  productionArtifacts,
  productionRuns,
  productionTasks,
  projects,
  references,
} from "@/db/schema";
import { getBucket } from "@/lib/storage";

export async function activeProject(ownerEmail: string, projectId: string) {
  const [project] = await getDb()
    .select()
    .from(projects)
    .where(and(
      eq(projects.id, projectId),
      eq(projects.ownerEmail, ownerEmail),
      eq(projects.status, "active"),
    ))
    .limit(1);
  return project ?? null;
}

export async function purgeProject(ownerEmail: string, projectId: string): Promise<void> {
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerEmail, ownerEmail)))
    .limit(1);
  if (!project) return;

  const [projectReferences, projectJobs, projectArtifacts] = await Promise.all([
    db.select().from(references).where(and(eq(references.ownerEmail, ownerEmail), eq(references.projectId, projectId))),
    db.select().from(jobs).where(and(eq(jobs.ownerEmail, ownerEmail), eq(jobs.projectId, projectId))),
    db.select().from(productionArtifacts).where(and(eq(productionArtifacts.ownerEmail, ownerEmail), eq(productionArtifacts.projectId, projectId))),
  ]);
  const objectKeys = new Set([
    ...projectReferences.map((reference) => reference.objectKey),
    ...projectJobs.flatMap((job) => job.outputObjectKey ? [job.outputObjectKey] : []),
    ...projectArtifacts.flatMap((artifact) => artifact.objectKey ? [artifact.objectKey] : []),
  ]);
  const bucket = getBucket();
  await Promise.all([...objectKeys].map((key) => bucket.delete(key)));

  await db.delete(productionTasks).where(and(eq(productionTasks.ownerEmail, ownerEmail), eq(productionTasks.projectId, projectId)));
  await db.delete(productionArtifacts).where(and(eq(productionArtifacts.ownerEmail, ownerEmail), eq(productionArtifacts.projectId, projectId)));
  await db.delete(productionRuns).where(and(eq(productionRuns.ownerEmail, ownerEmail), eq(productionRuns.projectId, projectId)));
  await db.delete(jobs).where(and(eq(jobs.ownerEmail, ownerEmail), eq(jobs.projectId, projectId)));
  await db.delete(directions).where(and(eq(directions.ownerEmail, ownerEmail), eq(directions.projectId, projectId)));
  await db.delete(references).where(and(eq(references.ownerEmail, ownerEmail), eq(references.projectId, projectId)));
  await db.delete(projects).where(and(eq(projects.ownerEmail, ownerEmail), eq(projects.id, projectId)));
}

export async function purgePendingProjects(ownerEmail: string): Promise<void> {
  const pending = await getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.ownerEmail, ownerEmail), eq(projects.status, "deleting")));
  for (const project of pending) await purgeProject(ownerEmail, project.id);
}
