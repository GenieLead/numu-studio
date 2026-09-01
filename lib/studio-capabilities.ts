export type ShotProductionMode = "generate" | "source_edit" | "hybrid";

export type StudioCapability = {
  id: string;
  department: string;
  operation: string;
  route: string;
  provider: "openrouter" | "google" | "local" | "external";
  status: "live" | "connector_required" | "planned";
  preserves: string[];
  limitations: string[];
  reason: string;
};

export const STUDIO_CAPABILITIES: StudioCapability[] = [
  {
    id: "story-intelligence",
    department: "Story & audience",
    operation: "Evidence, story, persuasion and structured shot direction",
    route: "OpenRouter capability-routed multimodal reasoning",
    provider: "openrouter",
    status: "live",
    preserves: ["approved concept", "audience objective", "reference evidence lineage"],
    limitations: ["model output remains subject to explicit human approval"],
    reason: "OpenRouter exposes many reasoning models behind one API while HAYK keeps the production schema and gates stable.",
  },
  {
    id: "identity-frames",
    department: "Visual development",
    operation: "Product, character and world identity plates; first and landing frames",
    route: "OpenRouter image API with live endpoint capability checks",
    provider: "openrouter",
    status: "live",
    preserves: ["reference images", "product geometry", "character wardrobe", "approved visual language"],
    limitations: ["identity must pass visual approval before motion"],
    reason: "Reference-aware image models are selected only when their live endpoint declares the required inputs, aspect ratio and resolution.",
  },
  {
    id: "generated-motion",
    department: "Picture production",
    operation: "New controlled motion from approved first and landing frames",
    route: "Seedance 2.5 through OpenRouter video API",
    provider: "openrouter",
    status: "live",
    preserves: ["approved boundary frames", "shot action", "camera contract"],
    limitations: ["generated footage is not exact-source preservation", "every take needs continuity QC"],
    reason: "This route is for creating a new shot, not for changing one element inside existing footage.",
  },
  {
    id: "source-edit",
    department: "VFX & source edit",
    operation: "Change wardrobe, environment or objects while preserving source performance",
    route: "Runway Aleph 2 or Seedance 2.5 multimodal edit through OpenRouter",
    provider: "openrouter",
    status: "live",
    preserves: ["source motion", "timing", "face/performance", "original audio carried as a protected stem"],
    limitations: ["uploaded edit segments are short", "the live route must declare video-reference support and exact pricing"],
    reason: "The source video is sent as the protected master reference; HAYK selects only a live OpenRouter route that accepts video input and refuses an unverified fallback.",
  },
  {
    id: "localized-vfx",
    department: "VFX & compositing",
    operation: "Mask, track and replace selected visual regions",
    route: "SAM 2 masks + source edit/composite service",
    provider: "local",
    status: "planned",
    preserves: ["unmasked pixels", "source timing", "plate provenance"],
    limitations: ["requires a server-side media worker and mask review"],
    reason: "A mask makes 'change only this' measurable instead of relying on prompt wording alone.",
  },
  {
    id: "voice-performance",
    department: "Dialogue & voice",
    operation: "Recorded performance, consented cloning, ADR and pronunciation takes",
    route: "OpenRouter speech API with stateless voice references",
    provider: "openrouter",
    status: "live",
    preserves: ["locked voice identity", "consent record", "script timing", "pronunciation lexicon"],
    limitations: ["Tunisian Derja and code-switching require an audition before casting", "voice conversion requires explicit performer consent"],
    reason: "Uploaded or recorded performance can remain exact or provide a stateless cloning reference; HAYK keeps voice identity, transcript and consent separate from picture generation.",
  },
  {
    id: "lip-sync",
    department: "Dialogue & voice",
    operation: "Drive an approved portrait performance from uploaded or generated audio",
    route: "HeyGen Avatar IV through OpenRouter video API",
    provider: "openrouter",
    status: "connector_required",
    preserves: ["approved audio timing", "vocal emotion", "portrait identity", "dialogue transcript"],
    limitations: ["Avatar IV is a portrait-animation route, not a universal existing-footage lip-sync engine", "full-body source footage uses a separately verified video-edit route"],
    reason: "The route is specified, but production remains blocked until the signed worker can prove face-preserving lip-sync on the selected source shots.",
  },
  {
    id: "derja-casting",
    department: "Dialogue & voice",
    operation: "Native Tunisian Derja casting, code-switching and gender/timbre conversion",
    route: "Blind audition adapter: OpenRouter voice clone first; specialist provider only if it wins",
    provider: "external",
    status: "connector_required",
    preserves: ["exact script", "timing", "emotion", "speaker consent", "pronunciation lexicon"],
    limitations: ["no provider is accepted from a marketing claim", "a Tunisian reviewer must approve the audition", "specialist API credentials are requested only if that route wins"],
    reason: "Derja quality is a casting decision. HAYK must compare the same lines and performance across providers before committing the production to one voice stack.",
  },
  {
    id: "music",
    department: "Music & sound",
    operation: "Score, stems, remix, Foley, ambience and effects",
    route: "Lyria 3 through OpenRouter; ACE-Step + Demucs worker fallback",
    provider: "openrouter",
    status: "live",
    preserves: ["music brief", "tempo map", "motifs", "licensed/source stem provenance"],
    limitations: ["final stem separation and loudness mastering require the media worker"],
    reason: "Lyria supplies an inexpensive continuous score through the existing OpenRouter connection; the timeline stores dialogue, music, ambience and effects as independently replaceable stems.",
  },
  {
    id: "editorial",
    department: "Editorial & finishing",
    operation: "Conform, transitions, mix, color management and mastering",
    route: "OpenTimelineIO + FFmpeg + OpenColorIO/ACES media worker",
    provider: "local",
    status: "connector_required",
    preserves: ["immutable sources", "handles", "timecode", "versioned edit decisions", "audio stems"],
    limitations: ["requires a dedicated worker; browser assembly remains preview-only until connected"],
    reason: "Professional editing needs a deterministic timeline and color-managed server conform, not a browser canvas export.",
  },
];

export const LONG_FORM_LEVELS = ["film", "reel", "sequence", "scene", "shot", "take", "frame_or_stem"] as const;

export function capabilityForMode(mode: ShotProductionMode): StudioCapability[] {
  if (mode === "source_edit") return STUDIO_CAPABILITIES.filter((item) => ["source-edit", "localized-vfx", "editorial"].includes(item.id));
  if (mode === "hybrid") return STUDIO_CAPABILITIES.filter((item) => ["identity-frames", "generated-motion", "source-edit", "localized-vfx", "editorial"].includes(item.id));
  return STUDIO_CAPABILITIES.filter((item) => ["identity-frames", "generated-motion", "editorial"].includes(item.id));
}
