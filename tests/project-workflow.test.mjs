import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("scopes studio records to independent project folders", async () => {
  const [schema, directionRoute, uploadRoute] = await Promise.all([
    readFile(`${root}/db/schema.ts`, "utf8"),
    readFile(`${root}/app/api/direction/route.ts`, "utf8"),
    readFile(`${root}/app/api/reference-uploads/finalize/route.ts`, "utf8"),
  ]);

  assert.match(schema, /studio_projects/);
  assert.match(schema, /projectId:\s*text\("project_id"\)/);
  assert.match(directionRoute, /eq\(directions\.projectId, projectId\)/);
  assert.match(directionRoute, /eq\(jobs\.status, "completed"\)/);
  assert.match(directionRoute, /approvalStage: "complete"/);
  assert.match(uploadRoute, /projectId/);
});

test("reveals the director treatment through staged approvals", async () => {
  const [shell, creativeAi, directionRoute] = await Promise.all([
    readFile(`${root}/components/studio/studio-shell.tsx`, "utf8"),
    readFile(`${root}/lib/creative-ai.ts`, "utf8"),
    readFile(`${root}/app/api/direction/route.ts`, "utf8"),
  ]);

  for (const label of ["Approve distinctive concept", "Approve visual world", "Approve shot sequence", "Approve sound direction", "Final lock"]) {
    assert.match(shell, new RegExp(label));
  }
  assert.match(shell, /Delete project/);
  assert.match(shell, /Each project has its own conversation, assets, approvals and versions/);
  assert.match(shell, /Analyze reference first/);
  assert.match(shell, /reanalyzeReferences: true/);
  assert.match(creativeAi, /DIRECTOR_MODEL/);
  assert.match(creativeAi, /protectedConcept/);
  assert.doesNotMatch(creativeAi, /model: "openrouter\/free"/);
  assert.match(directionRoute, /No generic direction was saved/);
  assert.match(directionRoute, /conceptLock/);
  assert.match(shell, /targetShotIds: selectedShotIds/);
  assert.match(shell, /selectedShotIds\.includes\(shot\.id\)/);
  assert.match(creativeAi, /mergeShotRevision\(existingShots, generatedShots, requestedShots\)/);
  assert.match(creativeAi, /if \(!reuseAnalyzedWorld && !protectVisualWorld\)/);
  assert.match(directionRoute, /revisionShotIds\(latest\.prompt\)/);
});

test("migrates the deleted perfume test without touching handwriting", async () => {
  const migration = await readFile(`${root}/drizzle/0001_quiet_talisman.sql`, "utf8");

  assert.match(migration, /legacy-perfume:/);
  assert.match(migration, /'deleting'/);
  assert.match(migration, /legacy-writing:/);
  assert.match(migration, /fresh-restart:/);
});

test("runs a visible gated studio pipeline instead of a hidden one-pass render", async () => {
  const [shell, productionRoute, evidenceClipRoute, productionAi, productionStudio, productionRouting, capabilities, schema, director] = await Promise.all([
    readFile(`${root}/components/studio/studio-shell.tsx`, "utf8"),
    readFile(`${root}/app/api/production/route.ts`, "utf8"),
    readFile(`${root}/app/api/production/evidence-clip/route.ts`, "utf8"),
    readFile(`${root}/lib/production-ai.ts`, "utf8"),
    readFile(`${root}/lib/production-studio.ts`, "utf8"),
    readFile(`${root}/lib/production-routing.ts`, "utf8"),
    readFile(`${root}/lib/studio-capabilities.ts`, "utf8"),
    readFile(`${root}/db/schema.ts`, "utf8"),
    readFile(`${root}/lib/director.ts`, "utf8"),
  ]);

  for (const label of ["Build visible AI evidence", "Generate identity plates", "Generate all shot frames", "Produce every source shot", "Assemble {deliverySeconds}s final test video", "Run continuity QC"]) {
    assert.match(shell, new RegExp(label));
  }
  assert.match(shell, /artifacts stream here/);
  assert.match(shell, /Production route map/);
  assert.match(shell, /Gemini Omni · protected source edit/);
  assert.match(shell, /\/api\/production\/tasks\/\$\{encodeURIComponent\(taskId\)\}/);
  assert.match(shell, /assembleSourceShots/);
  assert.match(shell, /onResetFailedArtifact/);
  assert.match(shell, /extractReferenceWindow/);
  assert.match(shell, /Bounded audiovisual window actually sent to AI/);
  assert.doesNotMatch(shell, /\/api\/generate/);
  assert.match(productionRoute, /https:\/\/openrouter\.ai\/api\/v1\/images/);
  assert.match(productionRoute, /frame_images/);
  assert.match(productionRoute, /generate_audio: !isSourceEdit/);
  assert.match(productionRoute, /type: "video_url", video_url/);
  assert.match(productionRoute, /reset_failed_artifact/);
  assert.match(productionAi, /type: "video_url"/);
  assert.match(productionAi, /hayk_evidence_dossier/);
  assert.match(productionAi, /hayk_master_qc/);
  assert.match(productionAi, /type:\s*"json_schema"/);
  assert.match(productionAi, /strict:\s*true/);
  assert.match(productionAi, /max_completion_tokens:\s*maxTokens/);
  assert.match(productionAi, /timed out after 65 seconds/);
  assert.match(productionAi, /full_multimodal_video/);
  assert.match(productionAi, /bounded_av_window/);
  assert.match(productionAi, /audioActuallyAnalyzed/);
  assert.match(productionAi, /will not pretend that sampled stills fully analyzed the footage/);
  assert.match(evidenceClipRoute, /kind: "reference_clip"/);
  assert.match(evidenceClipRoute, /The evidence source does not belong to this project/);
  assert.match(evidenceClipRoute, /on-device bounded audiovisual transcode/);
  assert.match(productionStudio, /google\/gemini-2\.5-pro/);
  assert.match(productionStudio, /bytedance-seed\/seedream-5-0-pro/);
  assert.match(productionStudio, /bytedance\/seedance-2\.5/);
  assert.match(productionStudio, /ShotRouteContract/);
  assert.match(productionStudio, /preserve_source/);
  assert.match(productionRouting, /if \(!capability\) return false/);
  assert.match(productionRouting, /input_references/);
  assert.match(schema, /studio_production_artifacts/);
  assert.match(schema, /studio_production_tasks/);
  assert.match(schema, /studio_production_nodes/);
  assert.match(capabilities, /source_edit/);
  assert.match(capabilities, /OpenTimelineIO \+ FFmpeg \+ OpenColorIO\/ACES/);
  assert.match(capabilities, /Lyria 3 through OpenRouter; ACE-Step \+ Demucs worker fallback/);
  assert.match(director, /REFERENCE AUTHORITY/);
  assert.match(director, /TIMED EDIT/);
  assert.match(director, /OBSERVED REFERENCE GRAMMAR/);
  assert.match(director, /IDENTITY AND FEASIBILITY CONTRACT/);
  assert.match(director, /ACTION STATE CONTRACT/);
  assert.match(productionRoute, /streamedJsonTask\(execute/);
  assert.match(productionRoute, /hayk\.production\.phase/);
  assert.match(productionRoute, /MOTION_SUBMISSION_TIMEOUT_MS = 20_000/);
  assert.match(productionRoute, /purpose: "provider_input"/);
  assert.match(productionRoute, /frame_type: "first_frame"/);
  assert.match(productionRoute, /frame_type: "last_frame"/);
  assert.doesNotMatch(productionRoute, /frame_type: "first_frame"[^\n]+objectDataUrl/);
  assert.match(productionRoute, /inArray\(productionArtifacts\.kind, \["master_cut", "review_cut"\]\)/);
  assert.match(productionRoute, /body\.action === "skip_score"/);
  assert.match(shell, /Continue without separate score/);
  assert.match(shell, /stage === "conform"[\s\S]*<AssemblyGate/);
  const assembly = shell.slice(shell.indexOf("async function assembleSourceShots"), shell.indexOf("async function recoverReferenceFile"));
  assert.ok(assembly.indexOf("for (const item of ordered)") >= 0);
  assert.ok(assembly.indexOf("recorder.start(1000)") >= 0);
  assert.ok(assembly.indexOf("drawVideoCover(drawing, prepared[0].video") >= 0);
  assert.ok(assembly.indexOf("for (const item of ordered)") < assembly.indexOf("recorder.start(1000)"));
  assert.ok(assembly.indexOf("drawVideoCover(drawing, prepared[0].video") < assembly.indexOf("recorder.start(1000)"));
  assert.match(assembly, /await waitForMedia\(video\)/);
});

test("OpenRouter can be reconnected directly when browser authorization is remembered", async () => {
  const [shell, connectRoute] = await Promise.all([
    readFile(`${root}/components/studio/studio-shell.tsx`, "utf8"),
    readFile(`${root}/app/api/openrouter/connect/route.ts`, "utf8"),
  ]);
  assert.match(shell, /Reconnect OpenRouter/);
  assert.match(shell, /type="password" value=\{openRouterKey\}/);
  assert.match(shell, /Use OpenRouter authorization/);
  assert.match(connectRoute, /export async function POST/);
  assert.match(connectRoute, /https:\/\/openrouter\.ai\/api\/v1\/key/);
  assert.match(connectRoute, /sealOpenRouterKey\(apiKey\)/);
  assert.match(connectRoute, /httpOnly: true/);
  assert.match(connectRoute, /sameSite: "strict"/);
});

test("persists direction operation phases and retry state for refresh-safe recovery", async () => {
  const [schema, migration] = await Promise.all([
    readFile(`${root}/db/schema.ts`, "utf8"),
    readFile(`${root}/drizzle/0007_grey_emma_frost.sql`, "utf8"),
  ]);
  for (const column of ["current_phase", "previous_phase", "phase_started_at", "provider_request_started", "retryable", "updated_at"]) {
    assert.match(migration, new RegExp(column));
  }
  assert.match(schema, /status:\s*text\("status"\).*default\("ready"\)/);
  assert.match(schema, /providerRequestStarted/);
  assert.match(schema, /retryable/);
});

test("samples reference videos globally and densely within a bounded local budget", async () => {
  const [shell, creativeAi, directionRoute] = await Promise.all([
    readFile(`${root}/components/studio/studio-shell.tsx`, "utf8"),
    readFile(`${root}/lib/creative-ai.ts`, "utf8"),
    readFile(`${root}/app/api/direction/route.ts`, "utf8"),
  ]);

  assert.match(shell, /MAX_LOCAL_STORYBOARD_FRAMES = 18/);
  assert.match(shell, /sampleKind: "global"/);
  assert.match(shell, /sampleKind: "deep"/);
  assert.match(creativeAi, /DENSE-WINDOW sample/);
  assert.match(creativeAi, /GLOBAL sample/);
  assert.match(creativeAi, /temperature: 0\.24/);
  assert.match(creativeAi, /Never invent camera gear/);
  assert.match(directionRoute, /MAX_LOCAL_STORYBOARD_FRAMES = 18/);
});
