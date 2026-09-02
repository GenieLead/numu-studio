import type {
  ConceptStrategy,
  DirectorCard,
  FilmGrammar,
  ReferenceBinding,
  ReferenceIntelligence,
  ShotSpec,
} from "@/lib/director";
import { DIRECTOR_CONTRACT_VERSION, mergeShotRevision, revisionShotIds, storyBeatsFromShots } from "@/lib/director";
import { evaluateConceptQuality } from "@/lib/concept-quality";
import { repairFilmGrammar } from "@/lib/film-grammar";
import { openRouterHeaders } from "@/lib/openrouter-session";
import { parseJsonWithLocalRepair } from "@/lib/json-repair";
import { DIRECTOR_MODEL } from "@/lib/production-studio";
import { getBucket } from "@/lib/storage";

type ReferenceRow = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  objectKey: string;
};

type StoryboardFrame = {
  sourceId: string;
  atSeconds: number;
  dataUrl: string;
  sampleKind?: "global" | "deep";
};

const directorStringListSchema = (maximum: number) => ({
  type: "array",
  items: { type: "string", maxLength: 220 },
  maxItems: maximum,
} as const);

const WORLD_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    filmGrammar: {
      type: "object",
      additionalProperties: false,
      properties: {
        genre: { type: "string", maxLength: 80 },
        era: { type: "string", maxLength: 80 },
        tempo: { type: "string", maxLength: 220 },
        camera: { type: "string", maxLength: 220 },
        lens: { type: "string", maxLength: 220 },
        lighting: { type: "string", maxLength: 220 },
        palette: { type: "string", maxLength: 220 },
      },
      required: ["genre", "era", "tempo", "camera", "lens", "lighting", "palette"],
    },
    referenceIntelligence: {
      type: "object",
      additionalProperties: false,
      properties: {
        styleDNA: directorStringListSchema(6),
        selectedEvidence: directorStringListSchema(6),
        audioEvidence: directorStringListSchema(5),
        continuityRisks: directorStringListSchema(8),
      },
      required: ["styleDNA", "selectedEvidence", "audioEvidence", "continuityRisks"],
    },
    lockedElements: directorStringListSchema(6),
  },
  required: ["filmGrammar", "referenceIntelligence", "lockedElements"],
} as const;

const CONCEPT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", maxLength: 80 },
    creativePromise: { type: "string", maxLength: 420 },
    conceptStrategy: {
      type: "object",
      additionalProperties: false,
      properties: {
        humanInsight: { type: "string", maxLength: 360 },
        centralTension: { type: "string", maxLength: 360 },
        creativeMechanism: { type: "string", maxLength: 420 },
        emotionalArc: { type: "string", maxLength: 360 },
        memoryDevice: { type: "string", maxLength: 360 },
        audiencePsychology: { type: "string", maxLength: 360 },
        brandOwnership: { type: "string", maxLength: 360 },
        referenceConnection: { type: "string", maxLength: 420 },
        distinctivenessProof: { type: "string", maxLength: 360 },
      },
      required: ["humanInsight", "centralTension", "creativeMechanism", "emotionalArc", "memoryDevice", "audiencePsychology", "brandOwnership", "referenceConnection", "distinctivenessProof"],
    },
  },
  required: ["title", "creativePromise", "conceptStrategy"],
} as const;

const SHOT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    shotPlan: {
      type: "array",
      minItems: 3,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", maxLength: 8 },
          time: { type: "string", maxLength: 24 },
          title: { type: "string", maxLength: 80 },
          purpose: { type: "string", maxLength: 180 },
          action: { type: "string", maxLength: 320 },
          camera: { type: "string", maxLength: 180 },
          sound: { type: "string", maxLength: 180 },
          route: { type: "string", maxLength: 140 },
          locks: directorStringListSchema(5),
        },
        required: ["id", "time", "title", "purpose", "action", "camera", "sound", "route", "locks"],
      },
    },
    productionMethod: directorStringListSchema(6),
    soundDesign: directorStringListSchema(6),
    hardGates: directorStringListSchema(8),
  },
  required: ["shotPlan", "productionMethod", "soundDesign", "hardGates"],
} as const;

function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    const chunk = bytes.subarray(offset, Math.min(offset + size, bytes.length));
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

function stringValue(value: unknown, fallback: string, maxLength = 600): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function stringList(value: unknown, fallback: string[], maximum = 6): string[] {
  if (!Array.isArray(value)) return fallback;
  const list = value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .slice(0, maximum)
    .map((item) => item.trim().slice(0, 220));
  return list.length ? list : fallback;
}

function filmGrammar(value: unknown, fallback: FilmGrammar): FilmGrammar {
  if (!value || typeof value !== "object") return fallback;
  const grammar = value as Record<string, unknown>;
  return repairFilmGrammar({
    genre: stringValue(grammar.genre, fallback.genre, 80),
    era: stringValue(grammar.era, fallback.era, 80),
    tempo: stringValue(grammar.tempo, fallback.tempo, 220),
    camera: stringValue(grammar.camera, fallback.camera, 220),
    lens: stringValue(grammar.lens, fallback.lens, 220),
    lighting: stringValue(grammar.lighting, fallback.lighting, 220),
    palette: stringValue(grammar.palette, fallback.palette, 220),
  });
}

function conceptStrategy(value: unknown, fallback: ConceptStrategy): ConceptStrategy {
  if (!value || typeof value !== "object") return fallback;
  const strategy = value as Record<string, unknown>;
  return {
    humanInsight: stringValue(strategy.humanInsight, fallback.humanInsight, 360),
    centralTension: stringValue(strategy.centralTension, fallback.centralTension, 360),
    creativeMechanism: stringValue(strategy.creativeMechanism, fallback.creativeMechanism, 420),
    emotionalArc: stringValue(strategy.emotionalArc, fallback.emotionalArc, 360),
    memoryDevice: stringValue(strategy.memoryDevice, fallback.memoryDevice, 360),
    audiencePsychology: stringValue(strategy.audiencePsychology, fallback.audiencePsychology, 360),
    brandOwnership: stringValue(strategy.brandOwnership, fallback.brandOwnership, 360),
    referenceConnection: stringValue(strategy.referenceConnection, fallback.referenceConnection, 420),
    distinctivenessProof: stringValue(strategy.distinctivenessProof, fallback.distinctivenessProof, 360),
  };
}

function shotPlan(value: unknown, fallback: ShotSpec[], allowPartial = false): ShotSpec[] {
  if (!Array.isArray(value)) return allowPartial ? [] : fallback;
  const shots = value
    .filter((item) => item && typeof item === "object")
    .slice(0, 7)
    .map((item, index) => {
      const shot = item as Record<string, unknown>;
      const requestedId = typeof shot.id === "string" && /^S\d{2}$/i.test(shot.id.trim())
        ? shot.id.trim().toUpperCase()
        : fallback[Math.min(index, fallback.length - 1)]?.id ?? `S${String(index + 1).padStart(2, "0")}`;
      const base = fallback.find((candidate) => candidate.id.toUpperCase() === requestedId) ?? fallback[Math.min(index, fallback.length - 1)] ?? fallback[0];
      if (!base) return null;
      return {
        id: requestedId,
        time: stringValue(shot.time, base.time, 24),
        title: stringValue(shot.title, base.title, 80),
        purpose: stringValue(shot.purpose, base.purpose, 180),
        action: stringValue(shot.action, base.action, 320),
        camera: stringValue(shot.camera, base.camera, 180),
        sound: stringValue(shot.sound, base.sound, 180),
        route: stringValue(shot.route, base.route, 140),
        locks: stringList(shot.locks, base.locks, 5),
      } satisfies ShotSpec;
    })
    .filter((shot): shot is ShotSpec => Boolean(shot));
  return allowPartial ? shots : shots.length >= 3 ? shots : fallback;
}

function referenceIntelligence(value: unknown, fallback: ReferenceIntelligence): ReferenceIntelligence {
  if (!value || typeof value !== "object") return fallback;
  const analysis = value as Record<string, unknown>;
  return {
    status: "analyzed",
    styleDNA: stringList(analysis.styleDNA, fallback.styleDNA, 6),
    selectedEvidence: stringList(analysis.selectedEvidence, fallback.selectedEvidence, 6),
    audioEvidence: stringList(analysis.audioEvidence, fallback.audioEvidence, 5),
    continuityRisks: [...new Set([
      ...fallback.continuityRisks,
      ...stringList(analysis.continuityRisks, [], 8),
    ])].slice(0, 8),
  };
}

function extractJson(content: string): unknown {
  try {
    return parseJsonWithLocalRepair(content);
  } catch {
    throw new Error("The director response was incomplete. Your references remain saved and no production render was started. Submit the same brief again.");
  }
}

async function upstreamErrorDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: unknown }; message?: unknown };
    const message = typeof payload.error?.message === "string"
      ? payload.error.message
      : typeof payload.message === "string"
        ? payload.message
        : "";
    return message.replace(/\s+/g, " ").trim().slice(0, 240);
  } catch {
    return "";
  }
}

async function boundedDirectorFetch(apiKey: string, body: Record<string, unknown>, label: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    return await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: openRouterHeaders(apiKey),
      signal: controller.signal,
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after 90 seconds. The accepted operation remains saved and no automatic retry was made.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function enhanceDirectorCard(
  apiKey: string,
  prompt: string,
  bindings: ReferenceBinding[],
  rows: ReferenceRow[],
  fallback: DirectorCard,
  storyboardFrames: StoryboardFrame[] = [],
  reuseAnalyzedWorld = false,
  onWorldReady?: (card: DirectorCard) => Promise<void>,
  onProviderRequest?: (phase: "analyzing_reference" | "planning") => Promise<void>,
): Promise<DirectorCard> {
  if (!apiKey) throw new Error("Reconnect OpenRouter before HAYK analyzes the references.");

  try {
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const roleSummary = bindings
      .map((binding) => {
        const row = rowById.get(binding.id);
        return row ? `${binding.role.toUpperCase()}: ${row.filename} (${row.mimeType}${binding.durationSeconds ? `, ${binding.durationSeconds.toFixed(1)}s` : ""})` : null;
      })
      .filter(Boolean)
      .join("\n");
    const protectedConcept = fallback.conceptLock ?? ((fallback.approvedSections ?? []).includes("concept")
      ? {
          title: fallback.title,
          creativePromise: fallback.creativePromise,
          objective: fallback.objective,
          audienceAction: fallback.audienceAction,
          conceptStrategy: fallback.conceptStrategy,
          conceptQuality: fallback.conceptQuality,
        }
      : null);
    const protectVisualWorld = (fallback.approvedSections ?? []).includes("language");
    let worldCard = fallback;

    if (!reuseAnalyzedWorld && !protectVisualWorld) {
      const content: Array<Record<string, unknown>> = [{
        type: "text",
        text: `FOUNDER BRIEF:\n${prompt}\n\nREFERENCE ROLES:\n${roleSummary || "No references supplied."}\n\nANALYSIS POLICY:\n${JSON.stringify(fallback.referenceAnalysis)}\n\nReturn only observable film grammar, evidence, risks and identity/world locks. Do not invent a concept, shots, sound plan or production route.`,
      }];
      let attachedBytes = 0;
      const imagePriority = [...bindings].sort((a, b) => {
        const priority = (role: ReferenceBinding["role"]) => {
          const index = ["product", "character", "location", "start", "end", "style", "patch"].indexOf(role);
          return index === -1 ? 99 : index;
        };
        return priority(a.role) - priority(b.role);
      });
      for (const binding of imagePriority) {
        const row = rowById.get(binding.id);
        if (!row?.mimeType.startsWith("image/") || attachedBytes + row.byteSize > 6 * 1024 * 1024) continue;
        const object = await getBucket().get(row.objectKey);
        if (!object) continue;
        const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
        attachedBytes += bytes.byteLength;
        content.push({ type: "text", text: `${binding.role.toUpperCase()} authority image: ${row.filename}` });
        content.push({ type: "image_url", image_url: { url: `data:${row.mimeType};base64,${bytesToBase64(bytes)}` } });
        if (attachedBytes >= 6 * 1024 * 1024 || content.length >= 9) break;
      }
      for (const frame of storyboardFrames.slice(0, fallback.referenceAnalysis.localStoryboardFrames)) {
        const sampleUse = frame.sampleKind === "deep" ? "DENSE-WINDOW cadence sample" : "GLOBAL range sample";
        content.push({ type: "text", text: `${frame.atSeconds.toFixed(1)}s ${sampleUse}; learn observable grammar only.` });
        content.push({ type: "image_url", image_url: { url: frame.dataUrl } });
        if (content.length >= 45) break;
      }

      await onProviderRequest?.("analyzing_reference");
      const worldResponse = await boundedDirectorFetch(apiKey, {
          model: DIRECTOR_MODEL,
          temperature: 0.18,
          max_completion_tokens: 2600,
          reasoning: { max_tokens: 1024, exclude: true },
          response_format: {
            type: "json_schema",
            json_schema: { name: "hayk_reference_world", strict: true, schema: WORLD_RESPONSE_SCHEMA },
          },
          messages: [
            {
              role: "system",
              content: "You are HAYK's reference-film analyst, cinematographer and continuity supervisor. Report only what is observable. PRODUCT owns exact geometry, material, logo and packaging. CHARACTER owns identity, body, wardrobe and performance. LOCATION owns the physical world. STYLE and MOTION contribute camera behavior, shot scale, lighting, palette, material treatment, edit density and transition grammar only—never their brand, product, actor, dialogue, voice, text or music. Treat multi-view sheets as one object. GLOBAL samples map range; DENSE-WINDOW samples reveal cadence. Separate evidence from inference. Never claim to hear silent frames. Never invent camera gear. Each filmGrammar value must be a complete noun phrase or one or two complete sentences under 180 characters; never end mid-phrase. Return concise film grammar, evidence, risks and locks only.",
            },
            { role: "user", content },
          ],
        }, "Reference analysis");
      if (!worldResponse.ok) {
        const detail = await upstreamErrorDetail(worldResponse);
        throw new Error(`HAYK could not complete the bounded reference analysis (${worldResponse.status})${detail ? `: ${detail}` : "."} Nothing was approved.`);
      }
      const worldPayload = (await worldResponse.json()) as { choices?: Array<{ finish_reason?: string | null; message?: { content?: string | Array<{ text?: string }> } }> };
      const worldChoice = worldPayload.choices?.[0];
      if (worldChoice?.finish_reason === "length") throw new Error("The bounded reference analysis reached its safe output limit. Your brief and references remain saved.");
      if (worldChoice?.finish_reason === "error") throw new Error("The reference-analysis provider interrupted the response. Your brief and references remain saved.");
      const worldRaw = worldChoice?.message?.content;
      const worldText = typeof worldRaw === "string" ? worldRaw : Array.isArray(worldRaw) ? worldRaw.map((item) => item.text ?? "").join("") : "";
      const generatedWorld = extractJson(worldText) as Record<string, unknown>;
      const resolvedGrammar = filmGrammar(generatedWorld.filmGrammar, fallback.filmGrammar);
      const intelligenceFallback: ReferenceIntelligence = storyboardFrames.length ? {
        status: "analyzed",
        styleDNA: [resolvedGrammar.genre, resolvedGrammar.tempo, resolvedGrammar.camera, resolvedGrammar.lighting, resolvedGrammar.palette],
        selectedEvidence: storyboardFrames.slice(0, fallback.referenceAnalysis.localStoryboardFrames).map((frame) => `${frame.atSeconds.toFixed(1)}s ${frame.sampleKind === "deep" ? "dense-window" : "global"} reference frame`),
        audioEvidence: bindings.some((binding) => ["style", "motion", "audio", "raw"].includes(binding.role)) ? ["Reference audio quarantined pending explicit voice and music decisions"] : [],
        continuityRisks: fallback.referenceIntelligence.continuityRisks,
      } : fallback.referenceIntelligence;
      worldCard = {
        ...fallback,
        model: DIRECTOR_MODEL,
        provider: "OpenRouter",
        filmGrammar: resolvedGrammar,
        referenceIntelligence: referenceIntelligence(generatedWorld.referenceIntelligence, intelligenceFallback),
        lockedElements: stringList(generatedWorld.lockedElements, fallback.lockedElements),
        analysisProvenance: {
          source: "ai",
          model: DIRECTOR_MODEL,
          provider: "OpenRouter",
          referenceCount: bindings.length,
          imageReferenceCount: bindings.filter((binding) => rowById.get(binding.id)?.mimeType.startsWith("image/")).length,
          storyboardFrameCount: storyboardFrames.length,
          contractVersion: "world-v1",
          generatedAt: new Date().toISOString(),
        },
      };
      await onWorldReady?.(worldCard);
    }

    if (protectedConcept) {
      return {
        ...worldCard,
        analysisProvenance: worldCard.analysisProvenance ? { ...worldCard.analysisProvenance, contractVersion: DIRECTOR_CONTRACT_VERSION } : undefined,
        title: protectedConcept.title,
        creativePromise: protectedConcept.creativePromise,
        objective: protectedConcept.objective,
        audienceAction: protectedConcept.audienceAction,
        conceptStrategy: protectedConcept.conceptStrategy,
        conceptQuality: protectedConcept.conceptQuality,
        conceptLock: protectedConcept,
      };
    }

    const conceptContext = {
      founderBrief: prompt,
      referenceRoles: roleSummary || "No references supplied.",
      filmGrammar: worldCard.filmGrammar,
      referenceIntelligence: worldCard.referenceIntelligence,
      identityAndWorldLocks: [...worldCard.lockedElements, ...worldCard.assetLocks.map((lock) => `${lock.type}: ${lock.name} (${lock.status})`)].slice(0, 16),
      sampledVideoFrameCount: worldCard.analysisProvenance?.storyboardFrameCount ?? storyboardFrames.length,
    };
    await onProviderRequest?.("planning");
    const conceptResponse = await boundedDirectorFetch(apiKey, {
        model: DIRECTOR_MODEL,
        temperature: 0.24,
        max_completion_tokens: 3400,
        reasoning: { max_tokens: 1024, exclude: true },
        response_format: {
          type: "json_schema",
          json_schema: { name: "hayk_concept_strategy", strict: true, schema: CONCEPT_RESPONSE_SCHEMA },
        },
        messages: [
          {
            role: "system",
            content: "You are HAYK, a chief creative director and audience-psychology strategist. Using only the supplied brief and saved reference intelligence, privately develop at least three genuinely different creative territories, compare human truth, tension, memorability, brand ownership and feasibility, then return the strongest. State a non-obvious human insight, observable central tension, brand-owned physical mechanism, emotional change, concrete memory device and audience psychology. The mechanism must be physically executable with clear real-world cause and effect; reject concepts that require literal interaction with an intangible abstraction or impossible material behavior. Prove the idea weakens if the protected brand, product, person or truth is substituted. When sampled video evidence exists, referenceConnection must cite at least two exact timestamps from selectedEvidence and explain the observable grammar learned—never copy a scene. Use complete, concise sentences and never end a field mid-sentence. Avoid generic advertising adjectives unless a physical mechanism proves them. Do not redesign the saved world or locks. Return concept strategy only: no shots, sound, providers, costs, retries or production methods.",
          },
          { role: "user", content: JSON.stringify(conceptContext) },
        ],
      }, "Concept strategy");
    if (!conceptResponse.ok) {
      const detail = await upstreamErrorDetail(conceptResponse);
      throw new Error(`HAYK could not complete the bounded concept strategy (${conceptResponse.status})${detail ? `: ${detail}` : "."} The saved reference analysis will be reused.`);
    }
    const conceptPayload = (await conceptResponse.json()) as { choices?: Array<{ finish_reason?: string | null; message?: { content?: string | Array<{ text?: string }> } }> };
    const conceptChoice = conceptPayload.choices?.[0];
    if (conceptChoice?.finish_reason === "length") throw new Error("The bounded concept response reached its safe output limit. The saved reference analysis will be reused without another media-analysis charge.");
    if (conceptChoice?.finish_reason === "error") throw new Error("The concept provider interrupted the response. The saved reference analysis will be reused without another media-analysis charge.");
    const conceptRaw = conceptChoice?.message?.content;
    const conceptText = typeof conceptRaw === "string" ? conceptRaw : Array.isArray(conceptRaw) ? conceptRaw.map((item) => item.text ?? "").join("") : "";
    const generatedConcept = extractJson(conceptText) as Record<string, unknown>;
    const resolvedConceptStrategy = conceptStrategy(generatedConcept.conceptStrategy, worldCard.conceptStrategy!);
    const storyboardFrameCount = worldCard.analysisProvenance?.storyboardFrameCount ?? storyboardFrames.length;

    return {
      ...worldCard,
      model: DIRECTOR_MODEL,
      provider: "OpenRouter",
      analysisProvenance: {
        ...(worldCard.analysisProvenance ?? {
          source: "ai" as const,
          model: DIRECTOR_MODEL,
          provider: "OpenRouter",
          referenceCount: bindings.length,
          imageReferenceCount: bindings.filter((binding) => rowById.get(binding.id)?.mimeType.startsWith("image/")).length,
          storyboardFrameCount,
          generatedAt: new Date().toISOString(),
        }),
        contractVersion: DIRECTOR_CONTRACT_VERSION,
        generatedAt: new Date().toISOString(),
      },
      title: stringValue(generatedConcept.title, worldCard.title, 80),
      creativePromise: stringValue(generatedConcept.creativePromise, worldCard.creativePromise, 420),
      conceptStrategy: resolvedConceptStrategy,
      conceptQuality: evaluateConceptQuality(resolvedConceptStrategy, storyboardFrameCount),
      conceptLock: null,
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("HAYK could not complete the visual reference analysis. Nothing was approved.");
  }
}

export async function enhanceShotPlan(
  apiKey: string,
  prompt: string,
  bindings: ReferenceBinding[],
  fallback: DirectorCard,
  previous?: DirectorCard | null,
  targetShotIds: string[] = [],
  onProviderRequest?: (phase: "planning") => Promise<void>,
): Promise<DirectorCard> {
  if (!apiKey) throw new Error("Reconnect OpenRouter before HAYK designs the shot graph.");

  try {
    const requestedShots = revisionShotIds(prompt, targetShotIds);
    const existingShots = previous?.shotPlan ?? fallback.shotPlan;
    const referenceRoles = bindings.map((binding) => `${binding.role.toUpperCase()}${binding.durationSeconds ? ` ${binding.durationSeconds.toFixed(1)}s` : ""}`).join(", ") || "none";
    const userContext = {
      founderRequest: prompt,
      runtimeSeconds: fallback.generationSeconds,
      deliverySeconds: fallback.deliverySeconds,
      approvedConcept: fallback.conceptLock ?? {
        title: fallback.title,
        creativePromise: fallback.creativePromise,
        objective: fallback.objective,
        audienceAction: fallback.audienceAction,
        conceptStrategy: fallback.conceptStrategy,
      },
      approvedVisualWorld: fallback.filmGrammar,
      referenceIntelligence: fallback.referenceIntelligence,
      referenceRoles,
      identityAndWorldLocks: [...fallback.lockedElements, ...fallback.assetLocks.map((lock) => `${lock.type}: ${lock.name} (${lock.status})`)].slice(0, 16),
      continuityRules: fallback.hardGates,
      existingShots: requestedShots.length ? existingShots : undefined,
      revisionTargets: requestedShots.length ? requestedShots : undefined,
    };

    await onProviderRequest?.("planning");
    const response = await boundedDirectorFetch(apiKey, {
        model: DIRECTOR_MODEL,
        temperature: 0.2,
        max_completion_tokens: 4400,
        reasoning: { max_tokens: 1024, exclude: true },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "hayk_shot_graph",
            strict: true,
            schema: SHOT_RESPONSE_SCHEMA,
          },
        },
        messages: [
          {
            role: "system",
            content:
              "You are HAYK's shot designer, editor, continuity supervisor and sound choreographer. Convert the already approved concept and visual world into a precise, separately replaceable shot graph. Do not redesign the concept or visual world. Fit the requested runtime exactly. Every shot must have one clear dramatic purpose, observable action, motivated camera behavior, explicit sound event, production route and identity/state locks. Cross-check anatomy, wardrobe, product state, scale, direction of movement, lighting and location continuity. Identity outranks action: redirect impossible actions instead of exposing, replacing or deforming protected features. Define important object start/end states and make causal actions visible in one continuous shot. Use stable S01-style IDs in chronological order. Design picture, dialogue/voice, music, ambience, Foley and effects as separable stems even when some remain silent. Never claim to have heard audio from image frames. For a surgical revision, return only the requested shot nodes and preserve their IDs; the application will merge them into the protected graph. Otherwise return the complete graph. Use concise observable language. Do not choose providers, prices, retry policy or paid media models.",
          },
          { role: "user", content: JSON.stringify(userContext) },
        ],
      }, "Shot planning");
    if (!response.ok) {
      const detail = await upstreamErrorDetail(response);
      throw new Error(`HAYK could not complete the bounded shot graph (${response.status})${detail ? `: ${detail}` : "."} Nothing was approved.`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ finish_reason?: string | null; message?: { content?: string | Array<{ text?: string }> } }>;
    };
    const choice = payload.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new Error("The bounded shot response reached its safe output limit. The approved concept and visual world remain saved for an exact retry.");
    }
    if (choice?.finish_reason === "error") {
      throw new Error("The shot-planning provider interrupted the response. The approved concept and visual world remain saved for an exact retry.");
    }
    const rawContent = choice?.message?.content;
    const text = typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((item) => item.text ?? "").join("")
        : "";
    const generated = extractJson(text) as Record<string, unknown>;
    const generatedShots = shotPlan(generated.shotPlan, existingShots, requestedShots.length > 0);
    const resolvedShots = previous && requestedShots.length
      ? mergeShotRevision(existingShots, generatedShots, requestedShots)
      : generatedShots;

    return {
      ...fallback,
      model: DIRECTOR_MODEL,
      provider: "OpenRouter",
      shotPlan: resolvedShots,
      storyBeats: storyBeatsFromShots(resolvedShots),
      productionMethod: stringList(generated.productionMethod, fallback.productionMethod),
      soundDesign: stringList(generated.soundDesign, fallback.soundDesign),
      hardGates: [...new Set([
        ...fallback.hardGates,
        ...stringList(generated.hardGates, [], 8),
      ])].slice(0, 12),
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("HAYK could not complete the bounded shot graph. Nothing was approved.");
  }
}

export async function enhanceRevisionPrompt(
  apiKey: string,
  userPrompt: string,
  taggedArtifactLabels: string[],
): Promise<string> {
  if (!apiKey) return userPrompt;
  try {
    const response = await boundedDirectorFetch(apiKey, {
      model: DIRECTOR_MODEL,
      temperature: 0.3,
      max_completion_tokens: 400,
      messages: [
        {
          role: "system",
          content: "You are a prompt enhancer for a cinematic image generation system. The user provides a rough revision request. Enhance it into a precise, detailed instruction that will produce better visual results. Keep the core intent. Be specific about visual changes, not vague. Output ONLY the enhanced prompt text, no explanations.",
        },
        {
          role: "user",
          content: taggedArtifactLabels.length > 0
            ? `User wants to regenerate these specific frames: ${taggedArtifactLabels.join(", ")}.\n\nUser's request: ${userPrompt}`
            : `User's request: ${userPrompt}`,
        },
      ],
    }, "prompt_enhancement");
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = body.choices?.[0]?.message?.content ?? "";
    const enhanced = typeof rawContent === "string" ? rawContent.trim() : "";
    return enhanced.length > 20 && enhanced.length < 1000 ? enhanced : userPrompt;
  } catch {
    return userPrompt;
  }
}
