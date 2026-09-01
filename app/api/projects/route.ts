import { and, desc, eq } from "drizzle-orm";
import { apiUserEmail, unauthorized } from "@/lib/api-auth";
import { getDb } from "@/db";
import { directions, jobs, productionRuns, projects, references } from "@/db/schema";
import type { DirectorCard } from "@/lib/director";
import { activeProject, purgePendingProjects, purgeProject } from "@/lib/projects";

function cleanName(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80)
    : "";
}

function projectStage(card: DirectorCard | null, jobStatus: string | null, productionStage: string | null, productionStatus: string | null): string {
  if (productionStage === "master") return "Master";
  if (productionStage) {
    if (productionStatus === "qc_blocked") return "QC revision";
    const labels: Record<string, string> = {
      evidence: "AI evidence",
      identity: "Identity plates",
      storyboard: "Shot frames",
      motion: "Source shots",
      voice: "Voice casting",
      score: "Score",
      stems: "Sound stems",
      conform: "Finishing",
      qc: "Continuity QC",
    };
    return labels[productionStage] ?? "Production";
  }
  if (jobStatus === "completed") return "Master";
  if (jobStatus && !["failed", "cancelled", "expired"].includes(jobStatus)) return "Production";
  if (!card) return "Idea";
  if (card.lockedAt) return "Production ready";
  const stage = card.approvalStage ?? "concept";
  if (stage === "complete") return "Ready to lock";
  const labels: Record<string, string> = {
    concept: "Concept",
    language: "Visual world",
    shots: "Shot plan",
    sound: "Sound",
    final: "Final review",
  };
  return labels[stage] ?? "Treatment";
}

export async function GET() {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  try {
    await purgePendingProjects(ownerEmail);
    const db = getDb();
    const [projectRows, directionRows, referenceRows, jobRows, productionRows] = await Promise.all([
      db.select().from(projects).where(and(eq(projects.ownerEmail, ownerEmail), eq(projects.status, "active"))).orderBy(desc(projects.updatedAt)),
      db.select().from(directions).where(eq(directions.ownerEmail, ownerEmail)).orderBy(desc(directions.createdAt)),
      db.select().from(references).where(eq(references.ownerEmail, ownerEmail)),
      db.select().from(jobs).where(eq(jobs.ownerEmail, ownerEmail)),
      db.select().from(productionRuns).where(eq(productionRuns.ownerEmail, ownerEmail)),
    ]);
    const latestByProject = new Map<string, typeof directionRows[number]>();
    for (const direction of directionRows) {
      if (direction.projectId && !latestByProject.has(direction.projectId)) latestByProject.set(direction.projectId, direction);
    }
    const referenceCount = new Map<string, number>();
    for (const reference of referenceRows) {
      if (reference.projectId) referenceCount.set(reference.projectId, (referenceCount.get(reference.projectId) ?? 0) + 1);
    }
    const jobByDirection = new Map<string, string>();
    for (const job of jobRows) {
      jobByDirection.set(job.directionId, job.status);
    }
    const productionByDirection = new Map(productionRows.map((run) => [run.directionId, run]));
    return Response.json({
      projects: projectRows.map((project) => {
        const latest = latestByProject.get(project.id);
        let card: DirectorCard | null = null;
        try { card = latest ? JSON.parse(latest.directionJson) as DirectorCard : null; } catch { card = null; }
        return {
          id: project.id,
          name: project.name,
          stage: projectStage(
            card,
            latest ? jobByDirection.get(latest.id) ?? null : null,
            latest ? productionByDirection.get(latest.id)?.currentStage ?? null : null,
            latest ? productionByDirection.get(latest.id)?.status ?? null : null,
          ),
          referenceCount: referenceCount.get(project.id) ?? 0,
          updatedAt: project.updatedAt,
        };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Projects could not be loaded.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const [project] = await getDb().insert(projects).values({
      id,
      ownerEmail,
      name: cleanName(body.name) || "Untitled film",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }).returning();
    return Response.json({ project: { ...project, stage: "Idea", referenceCount: 0 } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "A new project could not be created.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  try {
    const body = (await request.json()) as { projectId?: unknown; name?: unknown };
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const name = cleanName(body.name);
    if (!projectId || !name) return Response.json({ error: "Choose a project and enter a name." }, { status: 400 });
    if (!await activeProject(ownerEmail, projectId)) return Response.json({ error: "Project not found." }, { status: 404 });
    const [project] = await getDb().update(projects).set({ name, updatedAt: new Date().toISOString() })
      .where(and(eq(projects.id, projectId), eq(projects.ownerEmail, ownerEmail))).returning();
    return Response.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The project could not be renamed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const ownerEmail = await apiUserEmail();
  if (!ownerEmail) return unauthorized();
  try {
    const body = (await request.json()) as { projectId?: unknown };
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    if (!projectId || !await activeProject(ownerEmail, projectId)) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
    await getDb().update(projects).set({ status: "deleting", updatedAt: new Date().toISOString() })
      .where(and(eq(projects.id, projectId), eq(projects.ownerEmail, ownerEmail)));
    await purgeProject(ownerEmail, projectId);
    return Response.json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The project could not be deleted.";
    return Response.json({ error: message }, { status: 500 });
  }
}
