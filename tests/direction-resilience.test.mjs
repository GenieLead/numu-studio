import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("director uses three bounded strict structured responses with capped reasoning", async () => {
  const source = await readFile(new URL("lib/creative-ai.ts", root), "utf8");
  assert.match(source, /type:\s*"json_schema"/);
  assert.match(source, /strict:\s*true/);
  assert.match(source, /WORLD_RESPONSE_SCHEMA/);
  assert.match(source, /CONCEPT_RESPONSE_SCHEMA/);
  assert.match(source, /SHOT_RESPONSE_SCHEMA/);
  assert.match(source, /name:\s*"hayk_reference_world"/);
  assert.match(source, /name:\s*"hayk_concept_strategy"/);
  assert.match(source, /name:\s*"hayk_shot_graph"/);
  assert.match(source, /max_completion_tokens:\s*2600/);
  assert.match(source, /max_completion_tokens:\s*3400/);
  assert.match(source, /max_completion_tokens:\s*4400/);
  assert.equal((source.match(/reasoning:\s*\{ max_tokens:\s*1024, exclude:\s*true \}/g) ?? []).length, 3);
  assert.doesNotMatch(source, /require_parameters:\s*true/);
  assert.match(source, /upstreamErrorDetail/);
  assert.match(source, /finish_reason === "length"/);
});

test("an accepted direction never returns to the unsent composer", async () => {
  const source = await readFile(new URL("components/studio/studio-shell.tsx", root), "utf8");
  assert.match(source, /let requestAccepted = false/);
  assert.match(source, /if \(response\.ok\)[\s\S]*requestAccepted = true[\s\S]*setPrompt\(""\)/);
  assert.doesNotMatch(source, /setPrompt\(idea\)/);
  assert.match(source, /if \(!requestAccepted\)[\s\S]*submitted: false/);
  assert.match(source, /X-HAYK-Trace-Id/);
  assert.match(source, /payload\.draft\?\.references/);
});

test("long director requests stay alive and recover without a duplicate model submission", async () => {
  const serverSource = await readFile(new URL("app/api/direction/route.ts", root), "utf8");
  const streamSource = await readFile(new URL("lib/streamed-json.ts", root), "utf8");
  const clientSource = await readFile(new URL("components/studio/studio-shell.tsx", root), "utf8");
  assert.match(serverSource, /streamedJsonTask/);
  assert.match(streamSource, /HEARTBEAT_MS = 2_000/);
  assert.match(streamSource, /getRequestExecutionContext\(\)\?\.waitUntil/);
  assert.match(streamSource, /write\(" \\n"\)/);
  assert.match(clientSource, /recoverCompletedDirection/);
  assert.match(clientSource, /Polling is read-only/);
  assert.match(clientSource, /No automatic duplicate AI request was made/);
  const recoverySource = clientSource.slice(
    clientSource.indexOf("async function recoverCompletedDirection"),
    clientSource.indexOf("async function uploadReference"),
  );
  assert.doesNotMatch(recoverySource, /method:\s*"POST"/);
});

test("streamed AI work captures request credentials before the request context closes", async () => {
  const [directionRoute, productionRoute, creativeAi, productionAi] = await Promise.all([
    readFile(new URL("app/api/direction/route.ts", root), "utf8"),
    readFile(new URL("app/api/production/route.ts", root), "utf8"),
    readFile(new URL("lib/creative-ai.ts", root), "utf8"),
    readFile(new URL("lib/production-ai.ts", root), "utf8"),
  ]);

  assert.doesNotMatch(creativeAi, /getOpenRouterKey|cookies\s*\(/);
  assert.doesNotMatch(productionAi, /getOpenRouterKey|cookies\s*\(/);
  assert.match(creativeAi, /boundedDirectorFetch\(apiKey,/);
  assert.match(productionAi, /analyzeJson\(\s*apiKey,/);

  const directionCredential = directionRoute.indexOf("const directorApiKey");
  const directionStream = directionRoute.indexOf("return streamedJsonTask");
  assert.ok(directionCredential >= 0 && directionCredential < directionStream);

  const productionCredential = productionRoute.indexOf("const streamedApiKey");
  const productionTask = productionRoute.indexOf("const execute = async");
  assert.ok(productionCredential >= 0 && productionCredential < productionTask);
  assert.match(productionRoute, /analyzeEvidence\(production, streamedApiKey!\)/);
  assert.match(productionRoute, /generateNextImage\(production, streamedApiKey!\)/);
  assert.match(productionRoute, /runQc\(production, streamedApiKey!\)/);
  assert.match(productionRoute, /\["analyze_evidence", "generate_next_image", "run_qc"\]/);
});

test("paid image gates reject duplicate browser and database claims", async () => {
  const [productionRoute, clientSource] = await Promise.all([
    readFile(new URL("app/api/production/route.ts", root), "utf8"),
    readFile(new URL("components/studio/studio-shell.tsx", root), "utf8"),
  ]);
  assert.match(clientSource, /productionStageInFlightRef\.current/);
  assert.match(clientSource, /productionStageInFlightRef\.current = true/);
  assert.match(clientSource, /finally \{\s*productionStageInFlightRef\.current = false/);
  assert.match(productionRoute, /artifact\.status === "working"/);
  assert.match(productionRoute, /eq\(productionArtifacts\.status, "planned"\)/);
  assert.match(productionRoute, /\.returning\(\{ id: productionArtifacts\.id \}\)/);
  assert.match(productionRoute, /No duplicate request was sent/);
});

test("an interrupted paid stage resumes its saved approval without requesting a second ceiling", async () => {
  const clientSource = await readFile(new URL("components/studio/studio-shell.tsx", root), "utf8");
  assert.match(clientSource, /if \(production\.approvedCostUsd === null\)/);
  assert.match(clientSource, /authorizedMaxCostUsd=\{production\.approvedCostUsd\}/);
  assert.match(clientSource, /Approved stage · live route reverified/);
  assert.match(clientSource, /Continue the existing approval · no new ceiling/);
  assert.match(clientSource, /Continue \{quote\.itemCount\} remaining artifact/);
});

test("vertical production artifacts remain fully visible for approval", async () => {
  const clientSource = await readFile(new URL("components/studio/studio-shell.tsx", root), "utf8");
  const grid = clientSource.slice(clientSource.indexOf("function ArtifactGrid"), clientSource.indexOf("function PaidStageApproval"));
  assert.match(grid, /aspect-\[9\/16\]/);
  assert.match(grid, /className="object-contain"/);
  assert.doesNotMatch(grid, /object-cover/);
});

test("long image requests recover their terminal UI state through read-only polling", async () => {
  const [clientSource, productionRoute, productionServer, productionRouting] = await Promise.all([
    readFile(new URL("components/studio/studio-shell.tsx", root), "utf8"),
    readFile(new URL("app/api/production/route.ts", root), "utf8"),
    readFile(new URL("lib/production-server.ts", root), "utf8"),
    readFile(new URL("lib/production-routing.ts", root), "utf8"),
  ]);
  const effectStart = clientSource.indexOf('!["identity", "storyboard"].includes(production?.currentStage ?? "")');
  const effectEnd = clientSource.indexOf("const addFiles", effectStart);
  assert.ok(effectStart >= 0 && effectEnd > effectStart);
  const recovery = clientSource.slice(effectStart, effectEnd);
  assert.match(recovery, /fetch\(\s*`\/api\/production\?directionId=/);
  assert.match(recovery, /quote=false/);
  assert.match(recovery, /cache: "no-store"/);
  assert.match(recovery, /imageArtifacts\.every/);
  assert.match(recovery, /imageStageHasWorkingArtifact/);
  assert.match(recovery, /artifact\.status === "failed"/);
  assert.match(recovery, /setProductionAction\(null\)/);
  assert.doesNotMatch(recovery, /method:\s*"POST"/);
  assert.doesNotMatch(recovery, /generate_next_image|approve_budget/);
  assert.match(productionRoute, /AbortSignal\.timeout\(IMAGE_PROVIDER_TIMEOUT_MS\)/);
  assert.match(productionRoute, /IMAGE_PROVIDER_TIMEOUT_MS = 65_000/);
  assert.match(productionServer, /IMAGE_REQUEST_LEASE_MS = 85_000/);
  assert.match(productionServer, /reconcileInterruptedImageArtifacts/);
  assert.match(productionServer, /retryUsesExistingApproval: true/);
  assert.match(productionRoute, /usesExistingApproval/);
  assert.match(productionRoute, /status: "generating_images"/);
  assert.match(productionRoute, /revalidateApprovedImageRoute/);
  assert.match(productionRoute, /approvedImageRouteRecord/);
  assert.match(productionServer, /persistApprovedImageRoute/);
  assert.match(productionRouting, /AbortSignal\.timeout\(8_000\)/);
});

test("storyboard gates repair stale locks and exclude raw campaign frames from generation", async () => {
  const [productionRoute, productionServer, productionStudio, directionRoute] = await Promise.all([
    readFile(new URL("app/api/production/route.ts", root), "utf8"),
    readFile(new URL("lib/production-server.ts", root), "utf8"),
    readFile(new URL("lib/production-studio.ts", root), "utf8"),
    readFile(new URL("app/api/direction/route.ts", root), "utf8"),
  ]);
  const inputs = productionRoute.slice(
    productionRoute.indexOf("async function imageInputsFor"),
    productionRoute.indexOf("async function generateNextImage"),
  );
  assert.match(inputs, /identityRoles/);
  assert.match(inputs, /stage, "identity"/);
  assert.doesNotMatch(inputs, /reference_frame|evidenceFrames/);
  assert.match(productionServer, /repairPlannedStoryboardArtifacts/);
  assert.match(productionServer, /production-locks-v4/);
  assert.doesNotMatch(productionServer, /currentStage !== "storyboard" \|\| production\.run\.approvedCostUsd !== null/);
  assert.match(productionServer, /storyboardIdentityReferenceCount/);
  assert.match(productionStudio, /Global hard gates:/);
  assert.match(productionStudio, /safeProductionTranslations/);
  assert.match(directionRoute, /productionLockIssues/);
  assert.match(directionRoute, /lockSafeProductionShotPlan/);
});

test("the server persists novel drafts but keeps checkpoint retries out of the composer", async () => {
  const source = await readFile(new URL("app/api/direction/route.ts", root), "utf8");
  const saveIndex = source.indexOf("draftPrompt: prompt");
  const storyboardGateIndex = source.indexOf("requiresStoryboard && storyboardFrames.length === 0");
  const modelIndex = source.indexOf("await enhanceDirectorCard");
  assert.ok(saveIndex >= 0 && modelIndex >= 0 && saveIndex < modelIndex);
  assert.ok(storyboardGateIndex >= 0 && saveIndex < storyboardGateIndex);
  assert.match(source, /if \(!exactCheckpointReplay\)/);
  assert.match(source, /duplicateCheckpointDraft/);
  assert.match(source, /draftReferenceIds\.length/);
  assert.match(source, /draftReferenceIdsJson:\s*JSON\.stringify\(bindings\)/);
  assert.match(source, /status:\s*"processing"/);
  assert.match(source, /currentPhase:\s*activePhase/);
  assert.match(source, /providerRequestStarted:\s*false/);
  assert.match(source, /const markProviderRequest/);
  assert.match(source, /providerRequestStarted:\s*true/);
  assert.match(source, /status:\s*"failed"/);
  assert.match(source, /retryable:\s*true/);
  assert.match(source, /six-minute watchdog/);
  assert.match(source, /eq\(directions\.status, "processing"\)/);
});

test("refresh polling resumes one durable direction operation instead of resubmitting it", async () => {
  const serverSource = await readFile(new URL("app/api/direction/route.ts", root), "utf8");
  const clientSource = await readFile(new URL("components/studio/studio-shell.tsx", root), "utf8");
  assert.match(serverSource, /latestOperation/);
  assert.match(serverSource, /traceId:\s*latestOperation\.id/);
  assert.match(serverSource, /operation,/);
  assert.match(clientSource, /directionOperation\?\.status !== "processing"/);
  assert.match(clientSource, /submitInFlightRef\.current/);
  assert.match(clientSource, /method:\s*"POST"/);
  const pollingSource = clientSource.slice(
    clientSource.indexOf("directionOperation?.status !== \"processing\""),
    clientSource.indexOf("if (!activeProjectId || !direction?.id || !productionLocked)"),
  );
  assert.match(pollingSource, /fetch\(`\/api\/direction\?projectId=/);
  assert.doesNotMatch(pollingSource, /method:\s*"POST"/);
});

test("each bounded director provider phase has an explicit timeout and no automatic retry", async () => {
  const source = await readFile(new URL("lib/creative-ai.ts", root), "utf8");
  assert.match(source, /const timeout = setTimeout\(\(\) => controller\.abort\(\), 90_000\)/);
  assert.match(source, /timed out after 90 seconds/);
  assert.match(source, /no automatic retry was made/);
  assert.match(source, /await onProviderRequest\?\.\("analyzing_reference"\)/);
  assert.match(source, /await onProviderRequest\?\.\("planning"\)/);
});

test("production analysis finishes or fails before the site request lease expires", async () => {
  const source = await readFile(new URL("lib/production-ai.ts", root), "utf8");
  assert.match(source, /PRODUCTION_AI_TIMEOUT_MS = 65_000/);
  assert.match(source, /AbortSignal\.timeout\(PRODUCTION_AI_TIMEOUT_MS\)/);
  assert.match(source, /timed out after 65 seconds/);
  assert.match(source, /no retry was made/);
});

test("video jobs recover interrupted submission and secure media before becoming terminal", async () => {
  const [source, providerAssetRoute, protectedMediaRoute, productionRouting] = await Promise.all([
    readFile(new URL("app/api/production/tasks/[id]/route.ts", root), "utf8"),
    readFile(new URL("app/api/media-worker/artifacts/[id]/route.ts", root), "utf8"),
    readFile(new URL("app/api/production/artifacts/[id]/media/route.ts", root), "utf8"),
    readFile(new URL("lib/production-routing.ts", root), "utf8"),
  ]);
  assert.match(source, /task\.pollingUrl === "pending"/);
  assert.match(source, /Date\.now\(\) - pendingSince >= 30_000/);
  assert.match(source, /billing state is unknown/);
  assert.match(source, /status: status === "completed" \? "securing" : status/);
  assert.match(source, /uploaded\?\.status === "completed" && uploaded\.objectKey/);
  assert.match(source, /MEDIA_DOWNLOAD_TIMEOUT_MS = 45_000/);
  assert.match(providerAssetRoute, /grant\.purpose !== "provider_input"/);
  assert.match(providerAssetRoute, /artifact\.status !== "completed"/);
  assert.match(providerAssetRoute, /Content-Length/);
  assert.match(protectedMediaRoute, /Accept-Ranges/);
  assert.match(protectedMediaRoute, /Content-Range/);
  assert.match(protectedMediaRoute, /status: range \? 206 : 200/);
  assert.match(productionRouting, /supported_frame_images/);
  assert.match(productionRouting, /"first_frame"/);
  assert.match(productionRouting, /"last_frame"/);
});

test("an identical brief reuses its checkpoint instead of paying the director again", async () => {
  const serverSource = await readFile(new URL("app/api/direction/route.ts", root), "utf8");
  const clientSource = await readFile(new URL("components/studio/studio-shell.tsx", root), "utf8");
  assert.match(serverSource, /sameBindings\(bindings, previousBindings\)/);
  assert.match(serverSource, /previousCard\.conceptQuality\?\.status === "passed"/);
  assert.match(serverSource, /reused:\s*true/);
  assert.match(clientSource, /payload\.reused/);
  assert.match(clientSource, /current\.filter\(\(turn\) => turn\.id !== turnId\)/);
});

test("recovered videos are reopened before storyboard sampling", async () => {
  const source = await readFile(new URL("components/studio/studio-shell.tsx", root), "utf8");
  assert.match(source, /reference\.mimeType\.startsWith\("video\/"\)/);
  assert.match(source, /const file = await recoverReferenceFile\(source\)/);
  assert.match(source, /extractStoryboard\(file, source\.key, perVideo, 8\)/);
});

test("saved reference intelligence bypasses repeated local video sampling", async () => {
  const source = await readFile(new URL("components/studio/studio-shell.tsx", root), "utf8");
  assert.match(source, /reuseSavedReferenceAnalysis/);
  assert.match(source, /direction\?\.card\.referenceIntelligence\?\.status === "analyzed"/);
  assert.match(source, /const videoSources = reuseSavedReferenceAnalysis\s*\? \[\]/);
  assert.match(source, /Reusing the saved reference intelligence/);
  assert.match(source, /Reference video analysis timed out/);
});

test("concepts disclose whether AI or deterministic planning produced them", async () => {
  const aiSource = await readFile(new URL("lib/creative-ai.ts", root), "utf8");
  const uiSource = await readFile(new URL("components/studio/studio-shell.tsx", root), "utf8");
  assert.match(aiSource, /source:\s*"ai"/);
  assert.match(aiSource, /model:\s*DIRECTOR_MODEL/);
  assert.match(aiSource, /storyboardFrameCount:\s*storyboardFrames\.length/);
  assert.match(uiSource, /Analysis provenance/);
  assert.match(uiSource, /video frames/);
});

test("staged concept contract requires psychology, ownership and timestamped proof without domain hardcoding", async () => {
  const directorSource = await readFile(new URL("lib/director.ts", root), "utf8");
  const aiSource = await readFile(new URL("lib/creative-ai.ts", root), "utf8");
  const qualitySource = await readFile(new URL("lib/concept-quality.ts", root), "utf8");
  const routeSource = await readFile(new URL("app/api/direction/route.ts", root), "utf8");
  const uiSource = await readFile(new URL("components/studio/studio-shell.tsx", root), "utf8");
  assert.match(directorSource, /DIRECTOR_CONTRACT_VERSION = "concept-v3-staged"/);
  for (const field of ["humanInsight", "centralTension", "creativeMechanism", "memoryDevice", "audiencePsychology", "brandOwnership", "referenceConnection", "distinctivenessProof"]) {
    assert.match(aiSource, new RegExp(`${field}: \\{ type: "string", maxLength:`));
  }
  assert.match(qualitySource, /at least two sampled video timestamps/);
  assert.match(aiSource, /physically executable with clear real-world cause and effect/);
  assert.match(aiSource, /privately develop at least three genuinely different creative territories/i);
  assert.match(routeSource, /staged creative quality gate/);
  const baseStrategy = directorSource.slice(directorSource.indexOf("function baseConceptStrategy"), directorSource.indexOf("function requestedRuntime"));
  assert.doesNotMatch(baseStrategy, /falcon|NUMU|mist|perfume/i);
  assert.match(uiSource, /Automated concept checks/);
  assert.match(uiSource, /Passing does not replace founder creative approval/);
  assert.match(uiSource, /Upgrade concept/);
  assert.match(uiSource, /Approve distinctive concept/);
});

test("concept checkpoint repairs are local and do not masquerade as shot revisions", async () => {
  const routeSource = await readFile(new URL("app/api/direction/route.ts", root), "utf8");
  const uiSource = await readFile(new URL("components/studio/studio-shell.tsx", root), "utf8");
  assert.match(routeSource, /evaluateConceptQuality/);
  assert.match(routeSource, /repairedConceptCheckpoint/);
  assert.match(routeSource, /fallbackCard\.revisionPlan = null/);
  assert.match(routeSource, /repairFilmGrammar/);
  assert.match(routeSource, /explicitFilmRuntimeSeconds/);
  assert.match(routeSource, /requested === "concept" \? null : cardForApproval\.revisionPlan/);
  assert.match(uiSource, /Resolve the listed creative gate issues before approval/);
  assert.match(uiSource, /Video sampled/);
});

test("concept approval and shot planning are separate server stages", async () => {
  const aiSource = await readFile(new URL("lib/creative-ai.ts", root), "utf8");
  const routeSource = await readFile(new URL("app/api/direction/route.ts", root), "utf8");
  const worldSchema = aiSource.slice(aiSource.indexOf("const WORLD_RESPONSE_SCHEMA"), aiSource.indexOf("const CONCEPT_RESPONSE_SCHEMA"));
  const conceptSchema = aiSource.slice(aiSource.indexOf("const CONCEPT_RESPONSE_SCHEMA"), aiSource.indexOf("const SHOT_RESPONSE_SCHEMA"));
  assert.doesNotMatch(worldSchema, /conceptStrategy|shotPlan|productionMethod|soundDesign|hardGates/);
  assert.doesNotMatch(conceptSchema, /filmGrammar|referenceIntelligence|shotPlan|productionMethod|soundDesign|hardGates/);
  assert.match(routeSource, /requested === "language"\s*\? await enhanceShotPlan/);
  assert.match(routeSource, /shouldPlanShots/);
  assert.match(routeSource, /reuseAnalyzedWorld/);
  assert.match(routeSource, /saveWorldCheckpoint/);
});
