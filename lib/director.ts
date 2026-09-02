export type ReferenceRole =
  | "product"
  | "character"
  | "location"
  | "style"
  | "motion"
  | "audio"
  | "start"
  | "end"
  | "raw"
  | "patch";

export type ReferenceBinding = {
  id: string;
  role: ReferenceRole;
  durationSeconds?: number;
};

export type ReferenceMode = "inspiration" | "close-adaptation" | "source-edit";

export type ReferenceAnalysisPlan = {
  mode: ReferenceMode;
  requestedRuntimeSeconds: number;
  longestSourceSeconds: number | null;
  localStoryboardFrames: number;
  fullVideoSecondsSent: number;
  deepPassSeconds: number;
  fullPassRequiresApproval: boolean;
  strategy: string;
  costRule: string;
  authorityOrder: string[];
  exclusions: string[];
};

export type ReferenceIntelligence = {
  status: "planned" | "analyzed";
  styleDNA: string[];
  selectedEvidence: string[];
  audioEvidence: string[];
  continuityRisks: string[];
};

export type CreativeDecision = {
  id: "voiceover" | "music";
  question: string;
  context: string;
  recommended: string;
  options: string[];
  answer?: string | null;
  status: "open" | "resolved";
};

export type ShotSpec = {
  id: string;
  time: string;
  title: string;
  purpose: string;
  action: string;
  camera: string;
  sound: string;
  route: string;
  locks: string[];
};

export type AssetLock = {
  type: string;
  name: string;
  status: "locked" | "proposed" | "needed";
};

export type DepartmentSpec = {
  name: string;
  deliverable: string;
  status: "ready" | "working" | "waiting";
};

export type RevisionPlan = {
  target: string;
  operation: string;
  layers: string[];
  preserved: string[];
  reason: string;
  paidRenders: number;
};

export type FilmGrammar = {
  genre: string;
  era: string;
  tempo: string;
  camera: string;
  lens: string;
  lighting: string;
  palette: string;
};

export type ApprovalSection = "concept" | "language" | "shots" | "sound";
export type ApprovalStage = ApprovalSection | "final" | "complete";

export type ConceptLock = {
  title: string;
  creativePromise: string;
  objective: string;
  audienceAction: string;
  conceptStrategy?: ConceptStrategy;
  conceptQuality?: ConceptQuality;
};

export const DIRECTOR_CONTRACT_VERSION = "concept-v3-staged";

export type ConceptStrategy = {
  humanInsight: string;
  centralTension: string;
  creativeMechanism: string;
  emotionalArc: string;
  memoryDevice: string;
  audiencePsychology: string;
  brandOwnership: string;
  referenceConnection: string;
  distinctivenessProof: string;
};

export type ConceptQuality = {
  status: "passed" | "needs-revision";
  score: number;
  issues: string[];
};

export type DirectorCard = {
  title: string;
  creativePromise: string;
  objective: string;
  audienceAction: string;
  conceptStrategy?: ConceptStrategy;
  conceptQuality?: ConceptQuality;
  autonomy: "Autopilot" | "Collaborative" | "Expert";
  format: string;
  filmGrammar: FilmGrammar;
  storyBeats: Array<{ time: string; beat: string }>;
  shotPlan: ShotSpec[];
  assetLocks: AssetLock[];
  departments: DepartmentSpec[];
  referenceAnalysis: ReferenceAnalysisPlan;
  referenceIntelligence: ReferenceIntelligence;
  creativeDecisions: CreativeDecision[];
  approvalStage?: ApprovalStage;
  approvedSections?: ApprovalSection[];
  conceptLock?: ConceptLock | null;
  lockedAt?: string | null;
  revisionPlan?: RevisionPlan | null;
  lockedElements: string[];
  productionMethod: string[];
  soundDesign: string[];
  hardGates: string[];
  worldLocks?: string[];
  model: string;
  provider: string;
  analysisProvenance?: {
    source: "ai" | "deterministic";
    model: string;
    provider: string;
    referenceCount: number;
    imageReferenceCount: number;
    storyboardFrameCount: number;
    contractVersion?: string;
    generatedAt: string;
  };
  generationSeconds: number;
  deliverySeconds: number;
  estimatedCostUsd: number;
  maxCostUsd: number;
  paidPosts: number;
  retries: number;
};

const WRITING_SIGNAL = /\b(?:write|writing|pen|paper|notebook|ink|arabic|bismillah)\b|بسم|خط|اكتب/i;
const PERFUME_SIGNAL = /perfume|parfum|fragrance|scent|eau de parfum|bottle|عطر/i;
const START_OVER_SIGNAL = /start (again|over|from scratch)|from scratch|new film|new movie|restart everything/i;

function baseConceptStrategy(prompt: string, title = "The film"): ConceptStrategy {
  void prompt;
  return {
    humanInsight: "The audience remembers a brand when one truthful human tension is made physically observable instead of explained through advertising language.",
    centralTension: "A controlled surface must reveal an emotionally meaningful change without sacrificing the reality, identity or continuity of the supplied evidence.",
    creativeMechanism: `Build ${title} around one repeatable physical action whose consequence becomes the film's meaning, not around disconnected beauty shots.`,
    emotionalArc: "Curiosity becomes recognition, recognition becomes emotional commitment, and the final image resolves the original tension with restraint.",
    memoryDevice: "One concrete image, sound and action must recur or transform so the audience can recall the film after the branding disappears.",
    audiencePsychology: "Earn attention through tension and specificity, then reward it with a clear emotional resolution rather than an unmotivated reveal.",
    brandOwnership: "The core mechanism must depend on the supplied product, person or brand truth and become weaker if substituted by a competitor.",
    referenceConnection: "Use reference evidence only for observable grammar—cadence, scale, light, motion and material treatment—while protecting every supplied identity.",
    distinctivenessProof: "If another brand can inherit the concept unchanged, the concept has failed and must be rebuilt around a protected brand truth.",
  };
}

export function explicitFilmRuntimeSeconds(prompt: string): number | null {
  const minuteMatch = prompt.match(/\b(\d+(?:\.\d+)?)\s*[- ]?minutes?\b[^.\n]{0,80}\b(?:film|video|ad|advert|commercial|spot|movie|cut|piece)\b/i)
    ?? prompt.match(/\b(?:film|video|ad|advert|commercial|spot|movie|cut|piece)\b[^.\n]{0,80}\b(\d+(?:\.\d+)?)\s*(?:min|mins|minutes?)\b/i);
  if (minuteMatch) return Math.min(3600, Math.max(3, Number(minuteMatch[1]) * 60));
  const secondMatch = prompt.match(/\b(\d+(?:\.\d+)?)\s*[- ]?seconds?\b[^.\n]{0,80}\b(?:film|video|ad|advert|commercial|spot|movie|cut|piece)\b/i)
    ?? prompt.match(/\b(?:film|video|ad|advert|commercial|spot|movie|cut|piece)\b[^.\n]{0,80}\b(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)\b/i);
  return secondMatch ? Math.min(600, Math.max(3, Number(secondMatch[1]))) : null;
}

function requestedRuntime(prompt: string, fallback: number): number {
  const explicitFilmRuntime = explicitFilmRuntimeSeconds(prompt);
  if (explicitFilmRuntime !== null) return explicitFilmRuntime;
  const minuteMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)\b/i);
  if (minuteMatch) return Math.min(3600, Math.max(3, Number(minuteMatch[1]) * 60));
  const secondMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i);
  if (secondMatch) return Math.min(600, Math.max(3, Number(secondMatch[1])));
  return fallback;
}

function inferReferenceMode(prompt: string): ReferenceMode {
  if (/edit (this|my|the) (raw )?(video|footage)|preserve (this|the) footage|change only .*footage|use my raw footage/i.test(prompt)) return "source-edit";
  if (/shot[ -]?for[ -]?shot|exact(ly)? (recreate|reproduce|remake)|same (shots|timing|edit)|closely adapt/i.test(prompt)) return "close-adaptation";
  return "inspiration";
}

function buildReferenceAnalysis(prompt: string, references: ReferenceBinding[], runtime: number): ReferenceAnalysisPlan {
  const mode = inferReferenceMode(prompt);
  const durations = references.map((reference) => reference.durationSeconds ?? 0).filter((duration) => duration > 0);
  const longestSourceSeconds = durations.length ? Math.max(...durations) : null;
  const sampleFrames = references.some((reference) => ["style", "motion", "raw", "patch"].includes(reference.role))
    ? Math.min(18, Math.max(12, Math.ceil(runtime * 2)))
    : 0;
  const authorityOrder = [
    references.some((reference) => reference.role === "product") ? "PRODUCT owns exact geometry, material, logo and packaging" : "Product lock still needed",
    references.some((reference) => reference.role === "character") ? "CHARACTER owns face, body, wardrobe and performance identity" : "Character may be cast by HAYK",
    references.some((reference) => reference.role === "location") ? "LOCATION owns the physical world" : "Location may be inferred from the founder brief or character evidence",
    "STYLE and MOTION own grammar only—never identities, brands or products",
  ];
  const exclusions = [
    "Ignore logos, products, people and text inside STYLE or MOTION references",
    "A product visible inside a CHARACTER reference never overrides the PRODUCT reference",
    "Reference voice, language and music are evidence—not reusable masters unless explicitly licensed and approved",
  ];

  if (mode === "source-edit") {
    const full = longestSourceSeconds ?? runtime;
    return {
      mode,
      requestedRuntimeSeconds: runtime,
      longestSourceSeconds,
      localStoryboardFrames: sampleFrames,
      fullVideoSecondsSent: 0,
      deepPassSeconds: full,
      fullPassRequiresApproval: true,
      strategy: "Create a free local storyboard first, then request approval for one full source-aware analysis because the founder asked to edit the original footage.",
      costRule: "No long-video analysis runs silently. Full-source understanding receives its own price and approval card.",
      authorityOrder,
      exclusions,
    };
  }

  if (mode === "close-adaptation") {
    const deepPassSeconds = Math.min(longestSourceSeconds ?? runtime, Math.max(runtime, 30));
    return {
      mode,
      requestedRuntimeSeconds: runtime,
      longestSourceSeconds,
      localStoryboardFrames: sampleFrames,
      fullVideoSecondsSent: 0,
      deepPassSeconds,
      fullPassRequiresApproval: true,
      strategy: "Map the reference globally with local storyboard frames, then analyze only the source windows needed to preserve requested shot order and timing.",
      costRule: "A paid deep pass is bounded to the adaptation window and shown before it runs.",
      authorityOrder,
      exclusions,
    };
  }

  return {
    mode,
    requestedRuntimeSeconds: runtime,
    longestSourceSeconds,
    localStoryboardFrames: sampleFrames,
    fullVideoSecondsSent: 0,
    deepPassSeconds: Math.min(10, runtime, longestSourceSeconds ?? runtime),
    fullPassRequiresApproval: false,
    strategy: `Sample ${Math.ceil(sampleFrames / 2)} global frames across the source plus ${Math.floor(sampleFrames / 2)} dense frames inside a maximum ${Math.min(10, runtime)}-second window on-device. Learn both visual grammar and cut cadence without sending the full reference video.`,
    costRule: "Never pay to analyze the whole reference when it is inspiration for a shorter film.",
    authorityOrder,
    exclusions,
  };
}

function initialCreativeDecisions(prompt: string, references: ReferenceBinding[]): CreativeDecision[] {
  const hasTimedMedia = references.some((reference) => ["style", "motion", "audio", "raw", "patch"].includes(reference.role));
  const noVoice = /no voice|without voice|no dialogue|silent film/i.test(prompt);
  const arabicVoice = /arabic voice|voiceover.*arabic|arabic.*voiceover|تعليق صوتي|صوت عربي/i.test(prompt);
  const noMusic = /no music|sound design only|without music/i.test(prompt);
  const decisions: CreativeDecision[] = [];
  if (hasTimedMedia) {
    decisions.push({
      id: "voiceover",
      question: "Should this film speak?",
      context: "Reference speech may be a different language or brand. HAYK never carries it into the new film by accident.",
      recommended: "No voiceover—let image and sound design lead",
      options: ["No voiceover—let image and sound design lead", "Arabic voiceover", "Arabic endline only", "I will upload my voice"],
      answer: noVoice ? "No voiceover—let image and sound design lead" : arabicVoice ? "Arabic voiceover" : null,
      status: noVoice || arabicVoice ? "resolved" : "open",
    });
  }
  decisions.push({
    id: "music",
    question: "What should carry the emotion?",
    context: "Reference music defines pace only. The final film needs an original, licensed or founder-supplied sound choice.",
    recommended: "Original cinematic score + tactile sound design",
    options: ["Original cinematic score + tactile sound design", "Sound design only", "I will upload music", "Use a licensed trend after rights check"],
    answer: noMusic ? "Sound design only" : null,
    status: noMusic ? "resolved" : "open",
  });
  return decisions;
}

function resolveCreativeDecisions(decisions: CreativeDecision[] | undefined, prompt: string): CreativeDecision[] {
  return (decisions ?? []).map((decision) => {
    const direct = prompt.match(new RegExp(`Decision\\s+${decision.id}\\s*:\\s*([^\\n.]+)`, "i"));
    if (!direct?.[1]) return decision;
    return { ...decision, answer: direct[1].trim(), status: "resolved" as const };
  });
}

function locksFromReferences(references: ReferenceBinding[]): AssetLock[] {
  const labels: Record<ReferenceRole, string> = {
    product: "Product identity",
    character: "Character identity",
    location: "Location world",
    style: "Visual language",
    motion: "Motion evidence",
    audio: "Audio reference",
    start: "Opening frame",
    end: "Landing frame",
    raw: "Source footage",
    patch: "Iteration evidence",
  };
  const unique = [...new Set(references.map((reference) => reference.role))];
  const locks: AssetLock[] = unique.map((role) => ({ type: role, name: labels[role], status: "locked" }));
  if (!unique.includes("product")) locks.push({ type: "product", name: "Hero product", status: "needed" });
  return locks.slice(0, 7);
}

function departments(isWritingFilm: boolean): DepartmentSpec[] {
  return [
    { name: "Strategy", deliverable: "Attention and audience objective", status: "ready" },
    { name: "Visual development", deliverable: "World, character and product locks", status: "waiting" },
    { name: "Cinematography", deliverable: "Camera, light and shot choreography", status: "ready" },
    { name: "Sound", deliverable: "Music, ambience and tactile effects", status: "waiting" },
    { name: "Editorial", deliverable: isWritingFilm ? "Exact Arabic, grade and final assembly" : "Cut, grade and final assembly", status: "waiting" },
    { name: "Continuity QC", deliverable: "Frame-level hard-gate validation", status: "waiting" },
  ];
}

function writingShots(): ShotSpec[] {
  return [
    {
      id: "S01",
      time: "0.0–1.2s",
      title: "Stillness",
      purpose: "Create intimacy before the action begins.",
      action: "Blank notebook breathes under one motivated practical light.",
      camera: "Slow physical dolly-in · 50mm · f/4",
      sound: "Late-night room tone and one quiet breath",
      route: "Deterministic plate motion",
      locks: ["notebook", "desk", "lighting"],
    },
    {
      id: "S02",
      time: "1.2–3.0s",
      title: "Contact",
      purpose: "Make the hand and pen feel physically undeniable.",
      action: "One hand already owns one pen and settles at screen-right.",
      camera: "Static macro · rack focus to nib",
      sound: "Sleeve, fingertip and paper contact",
      route: "Premium image-to-video",
      locks: ["hand", "pen", "screen direction"],
    },
    {
      id: "S03",
      time: "3.0–5.6s",
      title: "The first mark",
      purpose: "Deliver the exact culturally credible action.",
      action: "Nib travels right-to-left; ink appears only at physical contact.",
      camera: "Tracked macro · no synthetic zoom",
      sound: "Close dry nib scratch",
      route: "Motion reference + deterministic ink composite",
      locks: ["hand path", "Arabic direction", "ink timing"],
    },
    {
      id: "S04",
      time: "5.6–6.8s",
      title: "Resolve",
      purpose: "Let the finished image become emotionally memorable.",
      action: "Pen lifts; exact phrase holds as the ink catches the light.",
      camera: "Optical push · restrained focus settle",
      sound: "Scratch ends; tonal cue resolves",
      route: "Local finishing and master",
      locks: ["exact phrase", "final composition", "grade"],
    },
  ];
}

function generalShots(prompt: string): ShotSpec[] {
  const subject = prompt.replace(/\s+/g, " ").trim().split(/[.!?]/)[0].slice(0, 92) || "the central idea";
  return [
    {
      id: "S01",
      time: "0.0–1.2s",
      title: "The hook",
      purpose: "Create immediate curiosity without explaining too early.",
      action: `A precise visual question introduces ${subject}.`,
      camera: "Controlled reveal · motivated movement only",
      sound: "One attention cue over location-specific room tone",
      route: "Efficient plate or image-to-video",
      locks: ["world", "palette", "screen direction"],
    },
    {
      id: "S02",
      time: "1.2–3.6s",
      title: "The sensation",
      purpose: "Turn the idea into one legible physical experience.",
      action: "One motivated action carries the emotional and product promise.",
      camera: "Intimate observer · lens chosen for material realism",
      sound: "Tactile Foley synchronized to contact",
      route: "Quality-routed motion generation",
      locks: ["product", "character", "action continuity"],
    },
    {
      id: "S03",
      time: "3.6–6.4s",
      title: "The payoff",
      purpose: "Make the brand or idea emotionally legible.",
      action: "The visual question resolves into a memorable hero moment.",
      camera: "Silent-machine move · clean landing composition",
      sound: "Music opens, then leaves space for the image",
      route: "Premium hero render",
      locks: ["identity", "geometry", "light direction"],
    },
    {
      id: "S04",
      time: "6.4–8.0s",
      title: "Brand memory",
      purpose: "Give the audience enough time to remember and act.",
      action: "Exact product, copy or CTA lands without generated typography.",
      camera: "Locked hero frame · optical finish",
      sound: "Short mnemonic resolve",
      route: "Deterministic product and typography finish",
      locks: ["logo", "copy", "final grade"],
    },
  ];
}

function perfumeShots(runtime: number): ShotSpec[] {
  const marks = [0, 0.16, 0.32, 0.55, 0.78, 1].map((ratio) => Number((runtime * ratio).toFixed(1)));
  const span = (index: number) => `${marks[index].toFixed(1)}–${marks[index + 1].toFixed(1)}s`;
  return [
    {
      id: "S01",
      time: span(0),
      title: "The signal",
      purpose: "Stop the scroll with a tactile product mystery.",
      action: "An extreme macro isolates one authoritative facet and the short straight cylindrical cap as black glass emerges from sculpted sand; no wide establishing shot and no character yet.",
      camera: "Graphic product macro · hard cut in · controlled parallax only",
      sound: "Dry wind, granular sand and a restrained low pulse",
      route: "Product-locked opening keyframe + image-to-video",
      locks: ["exact squat bottle geometry", "short straight cylindrical cap", "desert material"],
    },
    {
      id: "S02",
      time: span(1),
      title: "The material",
      purpose: "Make the fragrance feel touchable before it is explained.",
      action: "The same bottle becomes a near-black graphic silhouette; a narrow amber edge reveals its square shoulders, front plaque and embossed mark while airborne sand motivates the next hard cut.",
      camera: "Abstract product macro · tiny physical arc · no synthetic zoom",
      sound: "Glass resonance and wind-driven grains",
      route: "Deterministic product plate + controlled motion",
      locks: ["facets and square shoulders", "cap proportions", "embossed N and NUMU mark"],
    },
    {
      id: "S03",
      time: span(2),
      title: "The guardian",
      purpose: "Transfer the product's mystery into a memorable human presence.",
      action: "The locked falconer resolves as a sculptural black silhouette on the dune. His head wrap continues to cover hair, mouth, beard and neck; the full robe and falcon remain unchanged while real wind moves only loose cloth.",
      camera: "Compressed graphic portrait · restrained lateral track · hard cut",
      sound: "One wing beat, cloth movement and widening desert air",
      route: "Character-locked premium motion shot",
      locks: ["covered face and neck", "full black robe", "same falcon"],
    },
    {
      id: "S04",
      time: span(3),
      title: "The ritual",
      purpose: "Show one believable act of use without sacrificing product fidelity.",
      action: "Start already uncapped with the cap completely out of frame. In one uninterrupted close-up, the same exposed hand raises the exact NUMU bottle to the exposed wrist, the index finger visibly depresses the atomizer once, and one fine colorless mist reaches skin. Never spray the covered neck or reveal the face.",
      camera: "Locked hand-and-wrist macro · bottle, finger and wrist visible together · no face cutaway",
      sound: "Glass handling, atomizer click and one clean spray",
      route: "Start/end keyframes + premium action generation",
      locks: ["one bottle at constant scale", "already uncapped", "one visible press and mist"],
    },
    {
      id: "S05",
      time: span(4),
      title: "The memory",
      purpose: "Leave one unmistakable image of NUMU.",
      action: "Hard cut to the capped bottle alone, upright and front-facing on sand. Hold the exact squat silhouette, square shoulders, short straight cap, front plaque and embossed mark long enough to inspect; do not repeat the opening composition.",
      camera: "Locked frontal hero · no orbit · no morph · clean optical hold",
      sound: "Wind falls away; one original tonal signature resolves",
      route: "Product hero plate + local brand finish",
      locks: ["canonical front view", "exact cap and shoulder ratio", "final product scale"],
    },
  ];
}

function normalizedShotIds(ids: string[]): string[] {
  return [...new Set(ids
    .map((id) => id.trim().toUpperCase())
    .filter((id) => /^S\d{2}$/.test(id)))]
    .sort((left, right) => left.localeCompare(right));
}

export function revisionShotIds(prompt: string, targetShotIds: string[] = []): string[] {
  const selected = normalizedShotIds(targetShotIds);
  if (selected.length) return selected;
  const explicitClause = prompt.match(/(?:revise|change|replace|edit|update|regenerate|redo|fix|improve|adjust|retry|try)\s+only\s+([^.\n]+)/i)?.[1]
    ?? prompt.match(/(?:revise|change|replace|edit|update|regenerate|redo|fix|improve|adjust|retry|try)\s+([^.\n]+?)\s+only\b/i)?.[1]
    ?? "";
  const fromExplicit = normalizedShotIds([...explicitClause.matchAll(/\bS\d{2}\b/gi)].map((match) => match[0]));
  if (fromExplicit.length) return fromExplicit;
  const allMentions = [...prompt.matchAll(/\bS\d{2}\b/gi)].map((match) => match[0]);
  return normalizedShotIds(allMentions);
}

export function storyBeatsFromShots(shots: ShotSpec[]): DirectorCard["storyBeats"] {
  return shots.map((shot) => ({ time: shot.time, beat: `${shot.title}: ${shot.action}` }));
}

export function mergeShotRevision(previous: ShotSpec[], generated: ShotSpec[], requestedIds: string[]): ShotSpec[] {
  const requested = new Set(normalizedShotIds(requestedIds));
  if (!requested.size) return generated;
  const generatedById = new Map(generated.map((shot) => [shot.id.toUpperCase(), shot]));
  const previousIds = new Set(previous.map((shot) => shot.id.toUpperCase()));
  const unknown = [...requested].filter((id) => !previousIds.has(id));
  const missing = [...requested].filter((id) => !generatedById.has(id));
  if (unknown.length) throw new Error(`The requested shot ${unknown.join(", ")} does not exist in the protected master.`);
  if (missing.length) throw new Error(`HAYK did not return ${missing.join(" + ")}. Nothing changed.`);
  return previous.map((shot) => requested.has(shot.id.toUpperCase()) ? generatedById.get(shot.id.toUpperCase())! : shot);
}

export function createRevisionPlan(
  prompt: string,
  targetShotIds: string[] = [],
  approvalStage: ApprovalStage | null = null,
): RevisionPlan {
  const lower = prompt.toLowerCase();
  const requestedShots = revisionShotIds(prompt, targetShotIds);
  if (approvalStage === "concept" && requestedShots.length === 0) {
    return {
      target: "Concept strategy only",
      operation: "Replace only the unapproved idea while reusing the saved reference intelligence",
      layers: ["human insight", "central tension", "brand-owned mechanism"],
      preserved: ["Uploaded references", "Analyzed reference evidence", "Product and character identity", "No shots, sound or production media generated"],
      reason: "The concept is still awaiting founder approval, so no shot or locked production layer is being revised.",
      paidRenders: 0,
    };
  }
  const shotOnly = requestedShots.length > 0 || /\b(?:shot|camera|action|movement|hand|bottle|atomizer|spray|mist|gesture|choreograph)/.test(lower);
  const audioOnly = !shotOnly && /voice|voiceover|music|sound|audio|foley|volume|pronunciation/.test(lower);
  const arabicOnly = !shotOnly && /arabic|right.to.left|wrong direction|bismillah|بسم|writing|ink/.test(lower);
  const gradeOnly = !shotOnly && !audioOnly && !arabicOnly && /color|colour|grade|lighting|brighter|darker|contrast/.test(lower);
  const target = requestedShots.length
    ? `${requestedShots.join(" + ")} only`
    : audioOnly
      ? "Audio timeline only"
      : arabicOnly
        ? "S03 · handwriting layer only"
        : gradeOnly
          ? "Selected visual finishing layer"
          : "Smallest affected shot only";
  const operation = requestedShots.length
    ? "Replace only the requested shot choreography"
    : audioOnly
    ? "Replace and remix the requested audio layer"
    : arabicOnly
      ? "Rebuild the tracked ink path without regenerating the surrounding film"
      : gradeOnly
        ? "Re-grade the affected shot while preserving motion and identity"
        : "Patch the requested shot and reassemble against the locked master";
  return {
    target,
    operation,
    layers: requestedShots.length ? ["action", "camera", "object physics"] : audioOnly ? ["voice / music / sound"] : arabicOnly ? ["Arabic ink", "nib tracking"] : gradeOnly ? ["light", "color grade"] : ["requested visual layer"],
    preserved: ["Every unaffected shot", "Approved product and character locks", "Existing edit timing", "Original source and version history"],
    reason: "HAYK defaults to surgical revision. A full restart happens only when the founder explicitly asks for it.",
    paidRenders: 0,
  };
}

export function createDirectorCard(
  prompt: string,
  references: ReferenceBinding[],
  previous?: DirectorCard | null,
  targetShotIds: string[] = [],
): DirectorCard {
  if (previous && !START_OVER_SIGNAL.test(prompt)) {
    return {
      ...previous,
      conceptStrategy: previous.conceptStrategy ?? baseConceptStrategy(prompt, previous.title),
      conceptQuality: previous.conceptQuality ?? { status: "needs-revision", score: 0, issues: ["Awaiting the concept-v2 creative quality gate"] },
      lockedAt: null,
      revisionPlan: createRevisionPlan(prompt, targetShotIds, previous.approvalStage ?? "concept"),
      autonomy: previous.autonomy ?? "Collaborative",
      assetLocks: previous.assetLocks ?? locksFromReferences(references),
      referenceAnalysis: previous.referenceAnalysis ?? buildReferenceAnalysis(prompt, references, previous.deliverySeconds || 8),
      referenceIntelligence: previous.referenceIntelligence ?? {
        status: "planned",
        styleDNA: ["Reference grammar awaits the on-device storyboard pass"],
        selectedEvidence: [],
        audioEvidence: [],
        continuityRisks: [],
      },
      creativeDecisions: resolveCreativeDecisions(previous.creativeDecisions, prompt),
      departments: (previous.departments ?? departments(WRITING_SIGNAL.test(prompt))).map((department) =>
        department.name === "Editorial" || department.name === "Continuity QC"
          ? { ...department, status: "working" }
          : department,
      ),
      paidPosts: 0,
      estimatedCostUsd: 0,
      maxCostUsd: 0,
    };
  }

  const isWritingFilm = WRITING_SIGNAL.test(prompt);
  const isPerfumeFilm = PERFUME_SIGNAL.test(prompt);
  const hasStart = references.some((reference) => reference.role === "start");
  const hasEnd = references.some((reference) => reference.role === "end");
  const runtime = requestedRuntime(prompt, isWritingFilm ? 6.8 : 8);
  const shots = isWritingFilm ? writingShots() : isPerfumeFilm ? perfumeShots(runtime) : generalShots(prompt);
  const distilled = prompt.replace(/\s+/g, " ").trim().split(/[.!?]/)[0].slice(0, 72);
  const referenceAnalysis = buildReferenceAnalysis(prompt, references, runtime);

  return {
    title: isWritingFilm ? "The First Mark" : isPerfumeFilm ? "Desert Signature" : distilled || "Untitled Film",
    creativePromise: isWritingFilm
      ? "Turn a private moment of intention into a tactile beginning: real skin, real weight and an exact mark that feels discovered rather than generated."
      : isPerfumeFilm
        ? "Make NUMU feel like a rare desert presence: black glass, wind and ritual shaped into one precise memory rather than a catalogue demonstration."
      : "Transform one thought into an emotionally legible, brand-true film whose craft feels photographed, edited and heard—not merely generated.",
    objective: "Brand awareness and memorable emotional association",
    audienceAction: "Earn attention first; use a CTA only when the idea benefits from one",
    conceptStrategy: baseConceptStrategy(prompt, isWritingFilm ? "The First Mark" : isPerfumeFilm ? "Desert Signature" : distilled || "Untitled Film"),
    conceptQuality: { status: "needs-revision", score: 0, issues: ["Deterministic scaffold only; AI creative quality has not been verified"] },
    autonomy: "Collaborative",
    format: `${runtime}-second vertical cinematic film · 9:16`,
    filmGrammar: isWritingFilm
      ? { genre: "Spiritual intimacy", era: "Contemporary timeless", tempo: "Calm", camera: "Modern cinema", lens: "50mm macro", lighting: "Warm practical", palette: "Walnut, ink and amber" }
      : isPerfumeFilm
        ? { genre: "Luxury desert ritual", era: "Contemporary myth", tempo: "Precise, sensory, escalating", camera: "Product macro + compressed portrait", lens: "100mm macro / 75mm portrait", lighting: "Hard desert sun with amber edge control", palette: "Obsidian, warm sand and mineral blue" }
      : { genre: "Cinematic commercial", era: "Contemporary", tempo: "Calm → precise payoff", camera: "Modern cinema", lens: "Clean macro + portrait glass", lighting: "Motivated and directional", palette: "Reference-led, brand-safe" },
    storyBeats: shots.map((shot) => ({ time: shot.time, beat: `${shot.title}: ${shot.action}` })),
    shotPlan: shots,
    assetLocks: locksFromReferences(references),
    departments: departments(isWritingFilm),
    referenceAnalysis,
    referenceIntelligence: {
      status: "planned",
      styleDNA: referenceAnalysis.localStoryboardFrames
        ? ["Awaiting cost-free storyboard sampling across the reference timeline"]
        : ["Direction derived from the founder brief and supplied still references"],
      selectedEvidence: [],
      audioEvidence: references.some((reference) => ["style", "motion", "audio", "raw"].includes(reference.role))
        ? ["Reference audio is quarantined; voice, language and music require an explicit founder decision"]
        : [],
      continuityRisks: isPerfumeFilm
        ? [
            "Any bottle inside character or style imagery must be ignored when it conflicts with PRODUCT",
            "The character reference covers the face and neck, so fragrance must be applied to an exposed wrist unless the founder explicitly approves a wardrobe change",
            "A multi-view PRODUCT sheet describes one object; views must never be averaged into a new bottle",
          ]
        : [],
    },
    creativeDecisions: initialCreativeDecisions(prompt, references),
    approvalStage: "concept",
    approvedSections: [],
    lockedAt: null,
    revisionPlan: null,
    lockedElements: isWritingFilm
      ? ["One hand and one pen", "Notebook, walnut desk and practical light", "Screen-right origin and right-to-left travel", "Skin, shadows and physical contact"]
      : isPerfumeFilm
        ? ["Exact NUMU bottle from PRODUCT only", "Character, black wardrobe and falcon from CHARACTER", "Premium desert world", "Reference ad contributes grammar only"]
        : ["Brand and product identity", "Character and wardrobe", "Location and light direction", "Screen direction and action continuity"],
    productionMethod: [
      `${hasStart ? "Verified opening frame" : "Purpose-built opening keyframe"}${hasEnd ? " + verified landing frame" : ""}`,
      "Every shot receives its own route, references and hard gates",
      isWritingFilm ? "Exact Arabic remains a tracked deterministic layer" : "Products, logos and typography remain deterministic where accuracy matters",
      referenceAnalysis.costRule,
      "Approved shots survive every later revision",
    ],
    soundDesign: isWritingFilm
      ? ["Low late-night room tone", "Sleeve and fingertip contact", "Close dry nib scratch", "Subtle tonal resolve"]
      : isPerfumeFilm
        ? ["Real desert wind and cloth", "Falcon wing detail", "Glass handling and atomizer spray", "Original score only after founder's music decision"]
        : ["Location-specific ambience", "Tactile synchronized Foley", "One restrained emotional music idea", "Silence used deliberately"],
    hardGates: isWritingFilm
      ? ["No duplicate pen or anatomy defect", "No left-to-right writing origin", "No printed or pseudo-Arabic reveal", "No synthetic zoom, morph or sliding notebook"]
      : isPerfumeFilm
        ? [
            "PRODUCT reference overrides every conflicting bottle",
            "Bottle remains squat with square shoulders and a short straight cylindrical cap—never a tall, flared or chalice-shaped cap",
            "Character keeps the same covered face and neck, full black robe and falcon in every shot—never an exposed beard, crew-neck shirt or substitute actor",
            "Ritual begins already uncapped; never show cap removal; one visible finger press produces one fine colorless mist onto the exposed wrist",
            "No borrowed brand, actor, logo, subtitle or watermark from STYLE",
            "No morph transition, duplicate bottle, hand/nozzle defect, purposeless camera movement or invented NUMU typography",
          ]
        : ["No anatomy, continuity or identity defect", "No purposeless movement or synthetic zoom", "No mutated product, logo or generated typography", "No shot without emotional or informational purpose"],
    model: "quality-router",
    provider: "studio-orchestrator",
    analysisProvenance: {
      source: "deterministic",
      model: "none",
      provider: "local planning scaffold",
      referenceCount: references.length,
      imageReferenceCount: 0,
      storyboardFrameCount: 0,
      contractVersion: DIRECTOR_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
    },
    generationSeconds: 0,
    deliverySeconds: Math.round(runtime),
    estimatedCostUsd: 0,
    maxCostUsd: 0,
    paidPosts: 0,
    retries: 0,
  };
}

export function buildMotionPrompt(prompt: string, card: DirectorCard): string {
  return [
    "Create one photoreal live-action cinematic shot, not an animation or CGI render.",
    `Creative intent: ${prompt}`,
    `Emotional promise: ${card.creativePromise}`,
    `Lock throughout: ${card.lockedElements.join("; ")}.`,
    "Preserve believable weight, contact, inertia, skin deformation, reflections and shadows.",
    "Obey the selected shot's exact start state, end state, screen direction, camera path and protected asset locks.",
    "Do not generate logos, interface copy or precision typography; those belong to deterministic finishing.",
  ].join(" ");
}

export function buildProductionPrompt(card: DirectorCard): string {
  const shots = card.shotPlan.map((shot) =>
    `[${shot.time}] ${shot.title}: ${shot.action} Camera: ${shot.camera}. Sound: ${shot.sound}.`,
  ).join("\n");
  const voiceDecision = card.creativeDecisions.find((decision) => decision.id === "voiceover")?.answer;
  const musicDecision = card.creativeDecisions.find((decision) => decision.id === "music")?.answer;
  const styleDNA = card.referenceIntelligence.styleDNA.length
    ? card.referenceIntelligence.styleDNA.join("; ")
    : "Use only the approved visual world";
  const continuityRisks = card.referenceIntelligence.continuityRisks.length
    ? card.referenceIntelligence.continuityRisks.join("; ")
    : "No unresolved continuity risks";

  return [
    `Render one ${card.deliverySeconds}-second vertical luxury fragrance concept proof with ${card.shotPlan.length} unmistakable shot blocks separated by hard editorial cuts at the exact boundaries below. Never dissolve, morph or blend one shot into another.`,
    "This is photoreal live-action cinema captured on a real premium camera, never CGI, illustration, plastic skin, game-engine imagery or an AI demo.",
    `Creative promise: ${card.creativePromise}`,
    "REFERENCE AUTHORITY: input reference 1 is a multi-view sheet of ONE NUMU bottle. The centered upright frontal view is the canonical geometry master; the other views only confirm depth and facets. Never average, merge or morph the views. Preserve the squat rectangular faceted black-glass body, square shoulders, short straight cylindrical cap, front plaque, embossed N/NUMU mark, scale and proportions. Input reference 2 owns only the same falconer, fully covered head/face/neck, full black robe, falcon and desert. Completely ignore and remove the different LOCAL 971 bottle visible there. Never blend the two bottles.",
    `OBSERVED REFERENCE GRAMMAR: ${styleDNA}. Translate only this grammar: graphic black/white and amber contrast, abstract material macro, silhouette, compressed human detail, rhythmic hard cuts and a clean product landing. Do not copy its brand, actor, bottle, text, speech or music. Do not replace this grammar with a generic bright-blue-sky desert lifestyle montage.`,
    `VISUAL WORLD: ${card.filmGrammar.genre}; ${card.filmGrammar.camera}; ${card.filmGrammar.lens}; ${card.filmGrammar.lighting}; palette ${card.filmGrammar.palette}. Natural desert wind, real sand, restrained camera motion, believable weight and contact physics.`,
    `IDENTITY AND FEASIBILITY CONTRACT: the falconer remains the same covered person in the same full robe. Hair, mouth, beard and neck never become visible. Therefore the fragrance is applied only to the exposed wrist. If any requested action conflicts with identity or wardrobe, preserve identity and redirect the action—never alter the character to make the action possible. Bottle scale and geometry cannot change when it enters a hand.`,
    "ACTION STATE CONTRACT: before the ritual shot begins, the cap is already off and completely out of frame. Do not show unscrewing or cap removal. Keep bottle, pressing index finger and receiving wrist visible in one uninterrupted shot. Show exactly one complete atomizer depression, one synchronized spray transient and one fine colorless mist reaching skin. Hard cut afterward to the capped frontal hero; do not animate recapping.",
    "TIMED EDIT:",
    shots,
    `AUDIO: ${voiceDecision ?? "No voiceover—let image and sound design lead"}. ${musicDecision ?? "Original cinematic score + tactile sound design"}. Synchronize real desert wind, cloth, falcon detail, glass handling and one crisp atomizer spray. Never reuse speech or music from the inspiration ad.`,
    `LOCK THROUGHOUT: ${card.lockedElements.join("; ")}. CONTINUITY RISKS TO PREVENT: ${continuityRisks}.`,
    `HARD FAILS: ${card.hardGates.join("; ")}. One bottle only. Correct hands and nozzle. Fine colorless mist only. No captions, subtitles, title cards, extra logos, watermarks or invented typography. Preserve only the real embossed product mark already present in reference 1.`,
    "Finish with a calm, premium product hero frame that remains legible long enough to remember.",
  ].join("\n");
}
