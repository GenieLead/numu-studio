"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowUp,
  Camera,
  Check,
  ChevronRight,
  Clapperboard,
  Download,
  Film,
  Folder,
  FolderOpen,
  ImageIcon,
  Layers,
  Link2,
  LoaderCircle,
  Lock,
  Mic,
  MicOff,
  Music,
  Palette,
  Paperclip,
  Plus,
  Pencil,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Unplug,
  Video,
  Volume2,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  AssetLock,
  ApprovalSection,
  ApprovalStage,
  CreativeDecision,
  DepartmentSpec,
  DirectorCard,
  FilmGrammar,
  ReferenceAnalysisPlan,
  ReferenceIntelligence,
  ReferenceRole,
  RevisionPlan,
  ShotSpec,
} from "@/lib/director";
import { DIRECTOR_CONTRACT_VERSION } from "@/lib/director";
import { guardEvidenceDossier } from "@/lib/production-guardrails";
import {
  shotDurationSeconds,
  type ProductionArtifactPublic,
  type ReferenceEvidenceFrame,
  type ProductionRunPublic,
  type ProductionStage,
} from "@/lib/production-studio";
import { STUDIO_CAPABILITIES } from "@/lib/studio-capabilities";

type StoredReference = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
};

type WorkingReference = {
  key: string;
  id?: string;
  file?: File;
  filename: string;
  mimeType: string;
  byteSize: number;
  previewUrl?: string;
  role: ReferenceRole;
  durationSeconds?: number;
  submitted?: boolean;
};

type StoryboardFrame = {
  sourceKey: string;
  atSeconds: number;
  dataUrl: string;
  sampleKind: "global" | "deep";
};
type ChatTurn = {
  id: string;
  text: string;
  references: WorkingReference[];
  status: "sending" | "sent" | "failed";
};
type WorkingPhase = "reading" | "mapping" | "uploading" | "directing" | "revising" | null;

type DirectionState = { id: string; prompt: string; card: DirectorCard };
type DirectionOperationState = {
  id: string;
  traceId: string;
  status: "processing" | "failed";
  phase: string;
  previousPhase?: string | null;
  providerRequestStarted: boolean;
  error?: string | null;
  retryable: boolean;
};
type ConnectionState = { loading: boolean; connected: boolean; remainingUsd: number | null };
type SyncState = { loading: boolean; connected: boolean; model?: string; error?: string };
type MediaWorkerState = {
  loading: boolean;
  configured: boolean;
  online: boolean;
  productionReady: boolean;
  url?: string;
  workerVersion?: string | null;
  capabilities?: string[];
  missing?: string[];
  error?: string;
};
type Autonomy = "Autopilot" | "Collaborative" | "Expert";
type ProjectSummary = {
  id: string;
  name: string;
  stage: string;
  referenceCount: number;
  updatedAt: string;
};

const ROLE_LABELS: Record<ReferenceRole, string> = {
  product: "Product",
  character: "Character",
  location: "Location",
  style: "Visual style",
  motion: "Motion study",
  audio: "Voice / music / audio",
  start: "Opening frame",
  end: "Landing frame",
  raw: "Raw footage",
  patch: "Iteration evidence",
};

const REFERENCE_CHUNK_BYTES = 1024 * 1024;
const MAX_LOCAL_STORYBOARD_FRAMES = 18;
const URL_PATTERN = /https?:\/\/[^\s]+/i;
const PERFUME_PROMPT =
  "Create an 8-second premium vertical NUMU perfume film. PRODUCT is the only authority for the bottle. Treat its centered upright front view as the canonical geometry and use the other views only as dimensional evidence. CHARACTER supplies the same fully covered man, full black robe, falcon and desert world; his face and neck must remain covered, and any other bottle visible there must be ignored. Use the reference ad only for observable cinematic grammar, abstract material macros, silhouette, edit cadence, contrast and premium emotion—never its brand, actor, bottle, text, watermark, voice or music. Begin with a graphic NUMU product detail, reveal the character, then show one continuous wrist spray that starts already uncapped—never show cap removal—and finish on an exact frontal product hero. You have full creative autonomy, but ask me before choosing voiceover or music.";

async function responsePayload<T extends object>(response: Response): Promise<T & { error?: string }> {
  const text = await response.text();
  if (!text) return {} as T & { error?: string };
  try {
    return JSON.parse(text) as T & { error?: string };
  } catch {
    return {
      error:
        response.status === 413 || /payload too large/i.test(text)
          ? "That reference was too large. HAYK uploads files in secure parts; refresh once and try again."
          : text.slice(0, 240),
    } as T & { error?: string };
  }
}

function isConnectionInterruption(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network|connection|load failed/i.test(error.message);
}

async function recoverCompletedDirection(
  projectId: string,
  expectedPrompt: string,
  previousDirectionId?: string,
): Promise<DirectionState | null> {
  const normalizedExpected = expectedPrompt.replace(/\s+/g, " ").trim();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 800 : 2_000));
    try {
      const response = await fetch(`/api/direction?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const payload = await responsePayload<{ direction?: DirectionState }>(response);
      const candidate = payload.direction;
      if (
        response.ok &&
        candidate &&
        candidate.id !== previousDirectionId &&
        candidate.prompt.replace(/\s+/g, " ").trim() === normalizedExpected &&
        candidate.card.analysisProvenance?.contractVersion === DIRECTOR_CONTRACT_VERSION
      ) {
        return candidate;
      }
    } catch {
      // The original job may still be completing. Polling is read-only and
      // never submits a second model request.
    }
  }
  return null;
}

async function uploadReference(
  file: File,
  projectId: string,
  onProgress: (part: number, totalParts: number) => void,
): Promise<StoredReference> {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is larger than 25 MB.`);
  const uploadId = crypto.randomUUID();
  const totalParts = Math.ceil(file.size / REFERENCE_CHUNK_BYTES);

  for (let index = 0; index < totalParts; index += 1) {
    onProgress(index + 1, totalParts);
    const start = index * REFERENCE_CHUNK_BYTES;
    const chunk = file.slice(start, Math.min(start + REFERENCE_CHUNK_BYTES, file.size));
    const response = await fetch(
      `/api/reference-uploads/chunk?uploadId=${encodeURIComponent(uploadId)}&part=${index}`,
      { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: chunk },
    );
    const payload = await responsePayload<{ uploaded?: boolean }>(response);
    if (!response.ok || !payload.uploaded) throw new Error(payload.error ?? `Could not upload ${file.name}.`);
  }

  const response = await fetch("/api/reference-uploads/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, uploadId, filename: file.name, mimeType: file.type, byteSize: file.size, totalParts }),
  });
  const payload = await responsePayload<{ reference?: StoredReference }>(response);
  if (!response.ok || !payload.reference) throw new Error(payload.error ?? `Could not finish uploading ${file.name}.`);
  return payload.reference;
}

function defaultRole(file: File, existing: WorkingReference[], isIteration: boolean): ReferenceRole {
  if (isIteration) return "patch";
  if (file.type.startsWith("audio/")) return "audio";
  const name = file.name.toLowerCase();
  if (/product|bottle|pack|produit|flacon/.test(name)) return "product";
  if (/character|person|model|talent|personnage/.test(name)) return "character";
  if (/location|place|desert|lieu/.test(name)) return "location";
  if (file.type.startsWith("video/") && /raw|footage|source|rush/.test(name)) return "raw";
  if (file.type.startsWith("video/")) return "style";
  if (!existing.some((item) => item.role === "product")) return "product";
  if (!existing.some((item) => item.role === "character")) return "character";
  return "style";
}

function defaultStoredRole(reference: StoredReference, existing: WorkingReference[]): ReferenceRole {
  const name = reference.filename.toLowerCase();
  if (reference.mimeType.startsWith("audio/")) return "audio";
  if (/product|bottle|pack|produit|flacon/.test(name)) return "product";
  if (/character|person|model|talent|personnage/.test(name)) return "character";
  if (/location|place|desert|lieu/.test(name)) return "location";
  if (reference.mimeType.startsWith("video/") && /raw|footage|source|rush/.test(name)) return "raw";
  if (reference.mimeType.startsWith("video/")) return "style";
  if (!existing.some((item) => item.role === "product")) return "product";
  if (!existing.some((item) => item.role === "character")) return "character";
  return "style";
}

async function mediaDuration(file: File): Promise<number | undefined> {
  if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) return undefined;
  const url = URL.createObjectURL(file);
  const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
  media.preload = "metadata";
  media.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Media metadata timed out.")), 10000);
      media.onloadedmetadata = () => { window.clearTimeout(timer); resolve(); };
      media.onerror = () => { window.clearTimeout(timer); reject(new Error("Media metadata could not be read.")); };
    });
    return Number.isFinite(media.duration) ? Number(media.duration.toFixed(2)) : undefined;
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Reference sampling timed out.")), 5000);
    video.onseeked = () => { window.clearTimeout(timer); resolve(); };
    video.onerror = () => { window.clearTimeout(timer); reject(new Error("Reference frame could not be sampled.")); };
    video.currentTime = time;
  });
}

async function extractStoryboard(
  file: File,
  sourceKey: string,
  requestedFrames: number,
  deepWindowSeconds = 8,
): Promise<StoryboardFrame[]> {
  if (!file.type.startsWith("video/") || requestedFrames < 1) return [];
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Reference video analysis timed out.")), 15000);
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => { window.clearTimeout(timer); reject(new Error("Reference video could not be opened for analysis.")); };
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return [];
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 400 / Math.max(1, video.videoWidth));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return [];
    const boundedFrames = Math.min(MAX_LOCAL_STORYBOARD_FRAMES, Math.max(1, requestedFrames));
    const globalCount = Math.max(1, Math.ceil(boundedFrames / 2));
    const deepCount = Math.max(0, boundedFrames - globalCount);
    const deepWindow = Math.min(duration, Math.max(1, Math.min(10, deepWindowSeconds)));
    const planned: Array<{ atSeconds: number; sampleKind: StoryboardFrame["sampleKind"] }> = [];
    for (let index = 0; index < globalCount; index += 1) {
      planned.push({
        atSeconds: Math.min(duration - 0.05, duration * ((index + 0.5) / globalCount)),
        sampleKind: "global",
      });
    }
    for (let index = 0; index < deepCount; index += 1) {
      planned.push({
        atSeconds: Math.min(duration - 0.05, deepWindow * ((index + 0.5) / deepCount)),
        sampleKind: "deep",
      });
    }

    const frames: StoryboardFrame[] = [];
    const sampledMoments = new Set<number>();
    for (const sample of planned.sort((left, right) => left.atSeconds - right.atSeconds)) {
      const atSeconds = Math.max(0, sample.atSeconds);
      const momentKey = Math.round(atSeconds * 20);
      if (sampledMoments.has(momentKey)) continue;
      sampledMoments.add(momentKey);
      await seekVideo(video, Math.max(0, atSeconds));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({
        sourceKey,
        atSeconds: Number(atSeconds.toFixed(2)),
        dataUrl: canvas.toDataURL("image/jpeg", 0.58),
        sampleKind: sample.sampleKind,
      });
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function extractReferenceWindow(file: File, requestedSeconds: number): Promise<{ blob: Blob; durationSeconds: number }> {
  if (!file.type.startsWith("video/")) throw new Error("The audiovisual evidence source is not a video.");
  if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot create a bounded audiovisual evidence window.");
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;
  video.muted = false;
  video.volume = 1;
  video.src = url;
  let audioContext: AudioContext | null = null;
  let outputStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("The reference could not be opened for bounded audio analysis.")), 15000);
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => { window.clearTimeout(timer); reject(new Error("The reference could not be opened for bounded audio analysis.")); };
    });
    const durationSeconds = Math.min(video.duration, Math.max(1, Math.min(10, requestedSeconds)));
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("The reference duration could not be read.");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 480 / Math.max(1, video.videoWidth));
    canvas.width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
    const drawing = canvas.getContext("2d", { alpha: false });
    if (!drawing) throw new Error("The local audiovisual evidence canvas is unavailable.");
    const AudioContextClass = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser cannot preserve reference audio in the bounded evidence window.");
    audioContext = new AudioContextClass();
    await audioContext.resume();
    const source = audioContext.createMediaElementSource(video);
    const audioDestination = audioContext.createMediaStreamDestination();
    source.connect(audioDestination);
    const canvasStream = canvas.captureStream(24);
    outputStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
    const mimeType = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ].find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
    recorder = new MediaRecorder(outputStream, mimeType ? { mimeType, videoBitsPerSecond: 2_200_000 } : { videoBitsPerSecond: 2_200_000 });
    const chunks: Blob[] = [];
    const stopped = new Promise<Blob>((resolve, reject) => {
      recorder!.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder!.onerror = () => reject(new Error("The bounded audiovisual evidence recorder stopped unexpectedly."));
      recorder!.onstop = () => resolve(new Blob(chunks, { type: recorder!.mimeType || "video/webm" }));
    });
    video.currentTime = 0;
    recorder.start(500);
    await video.play();
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const paint = () => {
        drawVideoCover(drawing, video, canvas.width, canvas.height);
        if (performance.now() - startedAt >= durationSeconds * 1000 || video.ended) {
          resolve();
          return;
        }
        window.requestAnimationFrame(paint);
      };
      paint();
    });
    video.pause();
    recorder.stop();
    const blob = await stopped;
    if (!blob.size) throw new Error("The bounded audiovisual evidence window was empty.");
    return { blob, durationSeconds: Number(durationSeconds.toFixed(2)) };
  } finally {
    video.pause();
    if (recorder?.state && recorder.state !== "inactive") recorder.stop();
    outputStream?.getTracks().forEach((track) => track.stop());
    if (audioContext) await audioContext.close().catch(() => undefined);
    URL.revokeObjectURL(url);
  }
}

async function waitForMedia(media: HTMLMediaElement): Promise<void> {
  if (media.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("A source shot could not be opened for assembly.")), 15000);
    media.onloadeddata = () => { window.clearTimeout(timer); resolve(); };
    media.onerror = () => { window.clearTimeout(timer); reject(new Error("A source shot could not be opened for assembly.")); };
  });
}

function drawVideoCover(context: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number): void {
  const sourceWidth = Math.max(1, video.videoWidth);
  const sourceHeight = Math.max(1, video.videoHeight);
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  context.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

async function assembleSourceShots(
  artifacts: ProductionArtifactPublic[],
  shots: ShotSpec[],
  onProgress: (completed: number, total: number) => void,
): Promise<Blob> {
  const ordered = shots.map((shot) => ({
    shot,
    artifact: artifacts.find((artifact) => artifact.shotId === shot.id && artifact.kind === "shot_video" && artifact.mediaUrl),
  }));
  if (ordered.some((item) => !item.artifact?.mediaUrl)) throw new Error("Every approved source shot must be ready before assembly.");
  if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot assemble the protected cut. Use a current Chrome, Edge or Safari browser.");
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1280;
  const drawing = canvas.getContext("2d", { alpha: false });
  if (!drawing) throw new Error("The local edit canvas is unavailable.");
  const AudioContextClass = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("This browser cannot assemble synchronized audio.");
  const audioContext = new AudioContextClass();
  await audioContext.resume();
  const audioDestination = audioContext.createMediaStreamDestination();
  const canvasStream = canvas.captureStream(30);
  const outputStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);
  const mimeType = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ].find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
  const recorder = new MediaRecorder(outputStream, mimeType ? { mimeType, videoBitsPerSecond: 2_000_000 } : { videoBitsPerSecond: 2_000_000 });
  const chunks: Blob[] = [];
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error("The local edit recorder stopped unexpectedly."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
  });
  const videos: HTMLVideoElement[] = [];
  const prepared: Array<{ video: HTMLVideoElement; gain: GainNode }> = [];
  let scoreAudio: HTMLAudioElement | null = null;
  try {
    const scoreArtifact = artifacts.find((artifact) => artifact.kind === "score_master"
      && artifact.mediaUrl
      && artifact.metadata.deliberatelySkipped !== true);
    if (scoreArtifact?.mediaUrl) {
      scoreAudio = document.createElement("audio");
      scoreAudio.crossOrigin = "anonymous";
      scoreAudio.preload = "auto";
      scoreAudio.src = scoreArtifact.mediaUrl;
      await waitForMedia(scoreAudio);
      const scoreSource = audioContext.createMediaElementSource(scoreAudio);
      const scoreGain = audioContext.createGain();
      scoreGain.gain.value = 0.32;
      scoreSource.connect(scoreGain);
      scoreGain.connect(audioDestination);
      scoreAudio.currentTime = 0;
    }
    for (const item of ordered) {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.preload = "auto";
      video.playsInline = true;
      video.src = item.artifact!.mediaUrl!;
      videos.push(video);
      await waitForMedia(video);
      const source = audioContext.createMediaElementSource(video);
      const gain = audioContext.createGain();
      source.connect(gain);
      gain.connect(audioDestination);
      video.currentTime = 0;
      prepared.push({ video, gain });
    }
    drawVideoCover(drawing, prepared[0].video, canvas.width, canvas.height);
    recorder.start(1000);
    if (scoreAudio) await scoreAudio.play();
    for (const [index, item] of ordered.entries()) {
      const { video, gain } = prepared[index];
      video.currentTime = 0;
      const targetSeconds = Math.max(0.25, shotDurationSeconds(item.shot));
      const audioStart = audioContext.currentTime;
      const fadeSeconds = Math.min(0.08, targetSeconds / 4);
      gain.gain.setValueAtTime(0, audioStart);
      gain.gain.linearRampToValueAtTime(1, audioStart + fadeSeconds);
      gain.gain.setValueAtTime(1, audioStart + Math.max(fadeSeconds, targetSeconds - fadeSeconds));
      gain.gain.linearRampToValueAtTime(0, audioStart + targetSeconds);
      await video.play();
      const targetMilliseconds = targetSeconds * 1000;
      const startedAt = performance.now();
      await new Promise<void>((resolve) => {
        const paint = () => {
          drawVideoCover(drawing, video, canvas.width, canvas.height);
          if (performance.now() - startedAt >= targetMilliseconds || video.ended) {
            resolve();
            return;
          }
          window.requestAnimationFrame(paint);
        };
        paint();
      });
      video.pause();
      onProgress(index + 1, ordered.length);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    recorder.stop();
    const blob = await stopped;
    if (!blob.size) throw new Error("The assembled final test video was empty.");
    return blob;
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
    if (scoreAudio) { scoreAudio.pause(); scoreAudio.removeAttribute("src"); scoreAudio.load(); }
    videos.forEach((video) => { video.pause(); video.removeAttribute("src"); video.load(); });
    outputStream.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => undefined);
  }
}

async function recoverReferenceFile(reference: WorkingReference): Promise<File> {
  if (reference.file) return reference.file;
  if (!reference.previewUrl) throw new Error(`HAYK could not reopen ${reference.filename} for local analysis.`);
  const response = await fetch(reference.previewUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`HAYK could not reopen ${reference.filename} for local analysis.`);
  const blob = await response.blob();
  return new File([blob], reference.filename, { type: reference.mimeType || blob.type });
}

function compactBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function compactDuration(seconds?: number): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m${remainder ? ` ${remainder}s` : ""}`;
}

function fallbackGrammar(): FilmGrammar {
  return {
    genre: "Cinematic commercial",
    era: "Contemporary",
    tempo: "Director decides",
    camera: "Quality routed",
    lens: "Shot specific",
    lighting: "Motivated",
    palette: "Brand safe",
  };
}

function shotsFor(card: DirectorCard): ShotSpec[] {
  if (card.shotPlan?.length) return card.shotPlan;
  return (card.storyBeats ?? []).map((beat, index) => ({
    id: `S0${index + 1}`,
    time: beat.time,
    title: index === 0 ? "Opening beat" : index === (card.storyBeats?.length ?? 1) - 1 ? "Final hold" : `Beat ${index + 1}`,
    purpose: "Advance the feeling and information of the film.",
    action: beat.beat,
    camera: "Director-selected movement",
    sound: "Designed in a separate pass",
    route: "Capability-matched production route",
    locks: card.lockedElements?.slice(0, 3) ?? [],
  }));
}

function locksFor(card: DirectorCard, references: WorkingReference[]): AssetLock[] {
  if (card.assetLocks?.length) return card.assetLocks;
  return references.map((reference) => ({
    type: reference.role,
    name: ROLE_LABELS[reference.role],
    status: "locked" as const,
  }));
}

function departmentsFor(card: DirectorCard): DepartmentSpec[] {
  if (card.departments?.length) return card.departments;
  return [
    { name: "Direction", deliverable: "Treatment and shot design", status: "ready" },
    { name: "Visual development", deliverable: "Identity and world locks", status: "waiting" },
    { name: "Sound", deliverable: "Music, voice and Foley", status: "waiting" },
    { name: "Editorial + QC", deliverable: "Assembly and hard-gate review", status: "waiting" },
  ];
}

function referencePlanFor(card: DirectorCard, references: WorkingReference[]): ReferenceAnalysisPlan {
  if (card.referenceAnalysis) return card.referenceAnalysis;
  const durations = references.map((reference) => reference.durationSeconds ?? 0).filter(Boolean);
  return {
    mode: "inspiration",
    requestedRuntimeSeconds: card.deliverySeconds || 8,
    longestSourceSeconds: durations.length ? Math.max(...durations) : null,
    localStoryboardFrames: references.some((reference) => reference.mimeType.startsWith("video/")) ? 16 : 0,
    fullVideoSecondsSent: 0,
    deepPassSeconds: Math.min(10, card.deliverySeconds || 8),
    fullPassRequiresApproval: false,
    strategy: "Use global samples for visual range and a bounded dense window for edit cadence; never upload the full inspiration video for routine direction.",
    costRule: "Never analyze an entire long reference when a shorter inspiration pass is sufficient.",
    authorityOrder: ["PRODUCT owns product identity", "CHARACTER owns human identity", "STYLE and MOTION own grammar only"],
    exclusions: ["Different brands, people, speech, music, text and watermarks never transfer automatically"],
  };
}

function intelligenceFor(card: DirectorCard): ReferenceIntelligence {
  return card.referenceIntelligence ?? {
    status: "planned",
    styleDNA: ["Reference storyboard will be sampled on the founder's device"],
    selectedEvidence: [],
    audioEvidence: [],
    continuityRisks: [],
  };
}

function estimatedDirectionSeconds(references: WorkingReference[], isRevision: boolean): number {
  const totalMb = references.reduce((total, reference) => total + reference.byteSize, 0) / (1024 * 1024);
  const videoCount = references.filter((reference) => reference.mimeType.startsWith("video/")).length;
  return Math.round(Math.min(90, Math.max(isRevision ? 18 : 28, 22 + totalMb * 1.5 + videoCount * 8)));
}

function countdownLabel(seconds: number | null): string {
  if (seconds === null) return "Estimating…";
  if (seconds <= 0) return "Finishing…";
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${String(minutes).padStart(2, "0")}:${remainder}`;
}

function clockLabel(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function productionStageLabel(stage: ProductionStage): string {
  return {
    evidence: "AI evidence",
    identity: "Identity plates",
    storyboard: "Shot frames",
    motion: "Source shots",
    voice: "Voice casting",
    score: "Score",
    stems: "Sound stems",
    conform: "Finishing",
    qc: "Continuity QC",
    master: "Master",
  }[stage];
}

function humanMessage(text: string): string {
  const decision = text.match(/^Decision\s+(voiceover|music)\s*:\s*([^\n.]+)/i);
  if (!decision) return text;
  const label = decision[1].toLowerCase() === "voiceover" ? "Voiceover" : "Music & sound";
  return `${label}: ${decision[2].replace(/\. Preserve every.*$/i, "")}`;
}

function workingPhaseForOperation(operation: DirectionOperationState | null): WorkingPhase {
  if (!operation || operation.status !== "processing") return null;
  if (operation.phase === "analyzing_reference") return "mapping";
  return "directing";
}

export function StudioShell({ userName }: { userName: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const submitInFlightRef = useRef(false);
  const productionStageInFlightRef = useRef(false);
  const projectLoadTokenRef = useRef(0);
  const productionLoadTokenRef = useRef(0);
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<WorkingReference[]>([]);
  const [direction, setDirection] = useState<DirectionState | null>(null);
  const [directionOperation, setDirectionOperation] = useState<DirectionOperationState | null>(null);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [connection, setConnection] = useState<ConnectionState>({ loading: true, connected: false, remainingUsd: null });
  const [mediaWorker, setMediaWorker] = useState<MediaWorkerState>({ loading: true, configured: false, online: false, productionReady: false });
  const [syncLabs, setSyncLabs] = useState<SyncState>({ loading: true, connected: false });
  const [busy, setBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [workingPhase, setWorkingPhase] = useState<WorkingPhase>(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
  const [autonomy, setAutonomy] = useState<Autonomy>("Collaborative");
  const [recording, setRecording] = useState(false);
  const [productionLocked, setProductionLocked] = useState(false);
  const [production, setProduction] = useState<ProductionRunPublic | null>(null);
  const [productionLoading, setProductionLoading] = useState(false);
  const [productionAction, setProductionAction] = useState<string | null>(null);
  const [productionError, setProductionError] = useState<string | null>(null);
  const [productionElapsedSeconds, setProductionElapsedSeconds] = useState(0);
  const [assemblyProgress, setAssemblyProgress] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const pendingReferences = useMemo(() => references.filter((reference) => !reference.submitted), [references]);
  const activeProductionTaskIds = useMemo(() => (production?.tasks ?? [])
    .filter((task) => !["completed", "failed", "cancelled", "expired"].includes(task.status))
    .map((task) => task.id), [production?.tasks]);
  const imageStageHasWorkingArtifact = useMemo(() => Boolean(
    production
    && ["identity", "storyboard"].includes(production.currentStage)
    && production.artifacts.some((artifact) => artifact.stage === production.currentStage && artifact.status === "working")
  ), [production]);
  const productionUiAction = productionAction
    ?? (imageStageHasWorkingArtifact ? "Waiting for the current image result" : null);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      setEtaSeconds((current) => current === null ? null : Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const refreshConnection = useCallback(async () => {
    try {
      const response = await fetch("/api/openrouter/status", { cache: "no-store" });
      const payload = (await response.json()) as { connected?: boolean; remainingUsd?: number | null };
      setConnection({ loading: false, connected: Boolean(payload.connected), remainingUsd: payload.remainingUsd ?? null });
    } catch {
      setConnection({ loading: false, connected: false, remainingUsd: null });
    }
  }, []);

  const refreshMediaWorker = useCallback(async () => {
    try {
      const response = await fetch("/api/media-worker/connection", { cache: "no-store" });
      const payload = await responsePayload<Omit<MediaWorkerState, "loading">>(response);
      setMediaWorker({ loading: false, configured: Boolean(payload.configured), online: Boolean(payload.online), productionReady: Boolean(payload.productionReady), url: payload.url, workerVersion: payload.workerVersion, capabilities: payload.capabilities, missing: payload.missing, error: payload.error });
    } catch {
      setMediaWorker({ loading: false, configured: false, online: false, productionReady: false, error: "Worker status is unavailable." });
    }
  }, []);

  const refreshSyncLabs = useCallback(async () => {
    try {
      const response = await fetch("/api/sync/connection", { cache: "no-store" });
      const payload = await responsePayload<Omit<SyncState, "loading">>(response);
      setSyncLabs({ loading: false, connected: Boolean(payload.connected), model: payload.model, error: payload.error });
    } catch { setSyncLabs({ loading: false, connected: false, error: "Sync Labs status is unavailable." }); }
  }, []);

  const loadProductionRoute = useCallback(async (directionId: string, projectId: string) => {
    const token = ++productionLoadTokenRef.current;
    setProductionLoading(true);
    setProductionError(null);
    try {
      const response = await fetch(
        `/api/production?directionId=${encodeURIComponent(directionId)}&projectId=${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      const payload = await responsePayload<{ production?: ProductionRunPublic }>(response);
      if (token !== productionLoadTokenRef.current) return;
      if (!response.ok || !payload.production) throw new Error(payload.error ?? "The production studio could not be prepared.");
      setProduction(payload.production);
      setProductionElapsedSeconds(0);
    } catch (caught) {
      if (token !== productionLoadTokenRef.current) return;
      setProduction(null);
      setProductionError(caught instanceof Error ? caught.message : "The production studio could not be prepared.");
    } finally {
      if (token === productionLoadTokenRef.current) setProductionLoading(false);
    }
  }, []);

  const clearFilmState = useCallback(() => {
    productionLoadTokenRef.current += 1;
    setReferences((current) => {
      current.forEach((reference) => {
        if (reference.file && reference.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(reference.previewUrl);
      });
      return [];
    });
    setDirection(null);
    setDirectionOperation(null);
    setMessages([]);
    setPrompt("");
    setBusy(false);
    setUploadStatus(null);
    setWorkingPhase(null);
    setEtaSeconds(null);
    setSelectedShotIds([]);
    setProductionLocked(false);
    setProduction(null);
    setProductionLoading(false);
    setProductionAction(null);
    setProductionError(null);
    setProductionElapsedSeconds(0);
    setAssemblyProgress(null);
    setError(null);
  }, []);

  const refreshProjects = useCallback(async (preferredProjectId?: string | null) => {
    const response = await fetch("/api/projects", { cache: "no-store" });
    const payload = await responsePayload<{ projects?: ProjectSummary[] }>(response);
    if (!response.ok) throw new Error(payload.error ?? "Projects could not be loaded.");
    let nextProjects = payload.projects ?? [];
    if (!nextProjects.length) {
      const createdResponse = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled film" }),
      });
      const createdPayload = await responsePayload<{ project?: ProjectSummary }>(createdResponse);
      if (!createdResponse.ok || !createdPayload.project) throw new Error(createdPayload.error ?? "A blank project could not be created.");
      nextProjects = [createdPayload.project];
    }
    setProjects(nextProjects);
    setActiveProjectId((current) => {
      const stored = typeof window !== "undefined" ? window.localStorage.getItem("hayk-active-project") : null;
      const candidate = preferredProjectId ?? current ?? stored;
      const selected = nextProjects.some((project) => project.id === candidate) ? candidate! : nextProjects[0].id;
      window.localStorage.setItem("hayk-active-project", selected);
      return selected;
    });
  }, []);

  const loadProject = useCallback(async (projectId: string) => {
    const loadToken = ++projectLoadTokenRef.current;
    clearFilmState();
    const response = await fetch(`/api/direction?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const payload = await responsePayload<{
      direction?: {
        id: string;
        prompt: string;
        card: DirectorCard;
        bindings: Array<{ id: string; role: ReferenceRole; durationSeconds?: number }>;
        references: StoredReference[];
      } | null;
      history?: Array<{
        id: string;
        prompt: string;
        status: "processing" | "ready" | "failed";
        phase: string;
        error?: string | null;
        references: Array<StoredReference & { role: ReferenceRole; durationSeconds?: number }>;
      }>;
      draft?: {
        prompt: string;
        references: Array<StoredReference & { role?: ReferenceRole; durationSeconds?: number }>;
      } | null;
      operation?: DirectionOperationState | null;
    }>(response);
    if (loadToken !== projectLoadTokenRef.current) return;
    if (!response.ok) throw new Error(payload.error ?? "This project could not be opened.");
    const history = payload.history?.length
      ? payload.history
      : payload.direction
        ? [{ id: payload.direction.id, prompt: payload.direction.prompt, references: [], status: "ready" as const, phase: "ready", error: null }]
        : [];
    setMessages(history.map((turn) => ({
      id: turn.id,
      text: turn.prompt,
      references: turn.references.map((reference) => ({
        key: reference.id,
        id: reference.id,
        filename: reference.filename,
        mimeType: reference.mimeType,
        byteSize: reference.byteSize,
        previewUrl: `/api/references/${reference.id}/media`,
        role: reference.role,
        durationSeconds: reference.durationSeconds,
        submitted: true,
      })),
      status: turn.status === "processing" ? "sending" : turn.status === "failed" ? "failed" : "sent",
    })));
    const restoredOperation = payload.operation ?? null;
    const operationIsProcessing = restoredOperation?.status === "processing";
    setDirectionOperation(restoredOperation);
    setBusy(operationIsProcessing);
    setWorkingPhase(workingPhaseForOperation(restoredOperation));
    setUploadStatus(operationIsProcessing
      ? restoredOperation?.phase === "analyzing_reference"
        ? "Understanding the protected reference evidence…"
        : "Building the saved director checkpoint…"
      : null);
    if (restoredOperation?.status === "failed" && restoredOperation.error) setError(restoredOperation.error);
    if (!payload.direction) {
      const recovered: WorkingReference[] = [];
      for (const reference of payload.draft?.references ?? []) {
        recovered.push({
          key: reference.id,
          id: reference.id,
          filename: reference.filename,
          mimeType: reference.mimeType,
          byteSize: reference.byteSize,
          previewUrl: `/api/references/${reference.id}/media`,
          role: reference.role ?? defaultStoredRole(reference, recovered),
          durationSeconds: reference.durationSeconds,
          submitted: false,
        });
      }
      setPrompt(payload.draft?.prompt ?? "");
      setReferences(recovered);
      return;
    }
    const bindingMap = new Map(payload.direction.bindings.map((binding) => [binding.id, binding.role]));
    const durationMap = new Map(payload.direction.bindings.map((binding) => [binding.id, binding.durationSeconds]));
    const loadedReferences = payload.direction.references.map((reference) => ({
      key: reference.id,
      id: reference.id,
      filename: reference.filename,
      mimeType: reference.mimeType,
      byteSize: reference.byteSize,
      previewUrl: `/api/references/${reference.id}/media`,
      role: bindingMap.get(reference.id) ?? (reference.mimeType.startsWith("audio/") ? "audio" : reference.mimeType.startsWith("video/") ? "motion" : "style"),
      durationSeconds: durationMap.get(reference.id),
      submitted: true,
    } satisfies WorkingReference));
    setDirection({ id: payload.direction.id, prompt: payload.direction.prompt, card: payload.direction.card });
    setAutonomy(payload.direction.card.autonomy ?? "Collaborative");
    const knownIds = new Set(loadedReferences.map((reference) => reference.id));
    const restoredReferences = [...loadedReferences];
    for (const reference of payload.draft?.references ?? []) {
      if (knownIds.has(reference.id)) continue;
      restoredReferences.push({
        key: reference.id,
        id: reference.id,
        filename: reference.filename,
        mimeType: reference.mimeType,
        byteSize: reference.byteSize,
        previewUrl: `/api/references/${reference.id}/media`,
        role: reference.role ?? defaultStoredRole(reference, restoredReferences),
        durationSeconds: reference.durationSeconds,
        submitted: false,
      });
    }
    setPrompt(payload.draft?.prompt ?? "");
    setReferences(restoredReferences);
    setProductionLocked(Boolean(payload.direction.card.lockedAt));
  }, [clearFilmState]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshConnection();
      void refreshMediaWorker();
      void refreshSyncLabs();
      void refreshProjects().catch((caught) => setError(caught instanceof Error ? caught.message : "Projects could not be loaded."))
        .finally(() => setProjectsLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshConnection, refreshMediaWorker, refreshProjects, refreshSyncLabs]);

  useEffect(() => {
    if (!activeProjectId) return;
    window.localStorage.setItem("hayk-active-project", activeProjectId);
    const timer = window.setTimeout(() => {
      void loadProject(activeProjectId).catch((caught) => setError(caught instanceof Error ? caught.message : "This project could not be opened."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, loadProject]);

  useEffect(() => {
    if (!activeProjectId || directionOperation?.status !== "processing") return;
    let active = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(`/api/direction?projectId=${encodeURIComponent(activeProjectId)}`, { cache: "no-store" });
        const payload = await responsePayload<{ operation?: DirectionOperationState | null }>(response);
        if (!response.ok) throw new Error(payload.error ?? "HAYK could not resume the saved director operation.");
        if (!active) return;
        if (payload.operation?.status === "processing") {
          setDirectionOperation(payload.operation);
          setWorkingPhase(workingPhaseForOperation(payload.operation));
          setUploadStatus(payload.operation.phase === "analyzing_reference"
            ? "Understanding the protected reference evidence…"
            : "Building the saved director checkpoint…");
          return;
        }
        await loadProject(activeProjectId);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "HAYK could not resume the saved director operation.");
      } finally {
        polling = false;
      }
    };
    const first = window.setTimeout(() => void poll(), 2_500);
    const interval = window.setInterval(() => void poll(), 4_000);
    return () => {
      active = false;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [activeProjectId, directionOperation?.status, loadProject]);

  useEffect(() => {
    if (!activeProjectId || !direction?.id || !productionLocked) return;
    const timer = window.setTimeout(() => {
      void loadProductionRoute(direction.id, activeProjectId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, direction?.id, loadProductionRoute, productionLocked]);

  useEffect(() => {
    if (!productionAction && !activeProductionTaskIds.length && !imageStageHasWorkingArtifact) return;
    const tick = window.setInterval(() => setProductionElapsedSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(tick);
  }, [activeProductionTaskIds.length, imageStageHasWorkingArtifact, productionAction]);

  useEffect(() => {
    if (!activeProductionTaskIds.length) return;
    let active = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        let latest: ProductionRunPublic | null = null;
        for (const taskId of activeProductionTaskIds) {
          const response = await fetch(`/api/production/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
          const payload = await responsePayload<{ production?: ProductionRunPublic }>(response);
          if (!response.ok) throw new Error(payload.error ?? "HAYK could not check a source shot yet.");
          if (payload.production) latest = payload.production;
        }
        if (!active) return;
        if (latest) {
          setProduction(latest);
          const stillWorking = latest.tasks.some((task) => !["completed", "failed", "cancelled", "expired"].includes(task.status));
          if (!stillWorking) {
            setProductionAction(null);
            void refreshConnection();
            void refreshProjects(activeProjectId);
          }
        }
      } catch (caught) {
        if (active) setProductionError(caught instanceof Error ? caught.message : "HAYK could not check a source shot yet.");
      } finally {
        polling = false;
      }
    };
    const first = window.setTimeout(() => void poll(), 2500);
    const interval = window.setInterval(() => void poll(), 8000);
    return () => {
      active = false;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [activeProjectId, activeProductionTaskIds, refreshConnection, refreshProjects]);

  useEffect(() => {
    if (!activeProjectId || !direction?.id || (!productionAction && !imageStageHasWorkingArtifact) || !["identity", "storyboard"].includes(production?.currentStage ?? "")) return;
    let active = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(
          `/api/production?directionId=${encodeURIComponent(direction.id)}&projectId=${encodeURIComponent(activeProjectId)}&quote=false`,
          { cache: "no-store" },
        );
        const payload = await responsePayload<{ production?: ProductionRunPublic }>(response);
        if (!response.ok || !payload.production) throw new Error(payload.error ?? "HAYK could not observe the image result yet.");
        if (!active) return;
        const latest = payload.production;
        setProduction(latest);
        const imageArtifacts = latest.artifacts.filter((artifact) => artifact.stage === latest.currentStage);
        const failed = imageArtifacts.find((artifact) => artifact.status === "failed");
        if (failed) {
          setProductionAction(null);
          setProductionError(failed.error ?? "Image production stopped safely. No retry was made.");
          void refreshConnection();
          void refreshProjects(activeProjectId);
          return;
        }
        const terminal = imageArtifacts.length > 0 && imageArtifacts.every((artifact) => ["completed", "failed"].includes(artifact.status));
        if (terminal) {
          setProductionAction(null);
          void refreshConnection();
          void refreshProjects(activeProjectId);
        }
      } catch (caught) {
        if (active) setProductionError(caught instanceof Error ? caught.message : "HAYK could not observe the image result yet.");
      } finally {
        polling = false;
      }
    };
    const first = window.setTimeout(() => void poll(), 2_500);
    const interval = window.setInterval(() => void poll(), 4_000);
    return () => {
      active = false;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [activeProjectId, direction?.id, imageStageHasWorkingArtifact, production?.currentStage, productionAction, refreshConnection, refreshProjects]);

  const addFiles = useCallback((files: FileList | File[]) => {
    setReferences((current) => {
      const incoming = Array.from(files).slice(0, Math.max(0, 12 - current.length));
      const next = [...current];
      for (const file of incoming) {
        if (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !file.type.startsWith("audio/")) continue;
        next.push({
          key: crypto.randomUUID(),
          file,
          filename: file.name,
          mimeType: file.type,
          byteSize: file.size,
          previewUrl: URL.createObjectURL(file),
          role: defaultRole(file, next, Boolean(direction)),
          submitted: false,
        });
      }
      return next;
    });
  }, [direction]);

  const removeReference = (key: string) => {
    setReferences((current) => {
      const removed = current.find((item) => item.key === key);
      if (removed?.file && removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  };

  const startOrStopRecording = async () => {
    if (recording && recorderRef.current) {
      recorderRef.current.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => event.data.size && recordingChunksRef.current.push(event.data);
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const file = new File([blob], `hayk-voice-note-${Date.now()}.webm`, { type: blob.type });
        addFiles([file]);
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      setRecording(true);
    } catch {
      setError("Microphone access was not available. You can still attach an audio file.");
    }
  };

  const submitBrief = async (overrideIdea?: string, displayIdea?: string) => {
    const idea = (overrideIdea ?? prompt).trim();
    if (!idea || busy || !activeProjectId || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    let requestAccepted = false;
    let acceptedTraceId: string | null = null;
    let resumeProcessing = false;
    const turnId = crypto.randomUUID();
    const turnReferences = references.filter((reference) => !reference.submitted);
    const reuseSavedReferenceAnalysis = Boolean(
      direction?.card.referenceIntelligence?.status === "analyzed" &&
      turnReferences.length === 0,
    );
    setMessages((current) => [...current, {
      id: turnId,
      text: displayIdea ?? idea,
      references: turnReferences,
      status: "sending",
    }]);
    setReferences((current) => current.map((reference) => ({ ...reference, submitted: true })));
    setBusy(true);
    setWorkingPhase("reading");
    setEtaSeconds(estimatedDirectionSeconds(turnReferences, Boolean(direction)));
    setError(null);
    try {
      let resolved = await Promise.all(references.map(async (reference) => {
        if (!reference.file || reference.durationSeconds || (!reference.mimeType.startsWith("video/") && !reference.mimeType.startsWith("audio/"))) return { ...reference, submitted: true };
        return { ...reference, durationSeconds: await mediaDuration(reference.file), submitted: true };
      }));
      setReferences(resolved);

      const videoSources = reuseSavedReferenceAnalysis
        ? []
        : resolved.filter((reference) => reference.mimeType.startsWith("video/") && ["style", "motion", "raw", "patch"].includes(reference.role));
      const perVideo = videoSources.length ? Math.max(1, Math.floor(MAX_LOCAL_STORYBOARD_FRAMES / videoSources.length)) : 0;
      const storyboardFrames: StoryboardFrame[] = [];
      for (const source of videoSources) {
        setWorkingPhase("mapping");
        setUploadStatus(`Mapping ${source.filename} locally · no API video cost…`);
        const file = await recoverReferenceFile(source);
        storyboardFrames.push(...await extractStoryboard(file, source.key, perVideo, 8));
        if (storyboardFrames.length >= MAX_LOCAL_STORYBOARD_FRAMES) break;
      }

      const pending = resolved.filter((item) => item.file && !item.id);
      for (let fileIndex = 0; fileIndex < pending.length; fileIndex += 1) {
        const item = pending[fileIndex];
        setWorkingPhase("uploading");
        const stored = await uploadReference(item.file!, activeProjectId, (part, totalParts) => {
          setUploadStatus(`Securing reference ${fileIndex + 1} of ${pending.length} · part ${part} of ${totalParts}`);
        });
        resolved = resolved.map((candidate) => candidate.key === item.key
          ? { ...candidate, id: stored.id, file: undefined, filename: stored.filename, mimeType: stored.mimeType, byteSize: stored.byteSize, previewUrl: `/api/references/${stored.id}/media`, submitted: true }
          : candidate);
        if (item.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
        setReferences(resolved);
      }

      const submittedKeys = new Set(turnReferences.map((reference) => reference.key));
      setMessages((current) => current.map((turn) => turn.id === turnId
        ? { ...turn, references: resolved.filter((reference) => submittedKeys.has(reference.key)) }
        : turn));

      setWorkingPhase(direction ? "revising" : "directing");
      setUploadStatus(reuseSavedReferenceAnalysis
        ? "Reusing the saved reference intelligence…"
        : direction
          ? "Protecting the master and planning the smallest patch…"
          : "HAYK is directing the treatment…");
      const response = await fetch("/api/direction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: idea,
          projectId: activeProjectId,
          previousDirectionId: direction?.id,
          targetShotIds: selectedShotIds,
          autonomy,
          references: resolved
            .filter((item) => Boolean(item.id))
            .map((item) => ({ id: item.id!, role: item.role, durationSeconds: item.durationSeconds })),
          storyboardFrames: storyboardFrames
            .slice(0, MAX_LOCAL_STORYBOARD_FRAMES)
            .map((frame) => ({
              sourceId: resolved.find((item) => item.key === frame.sourceKey)?.id ?? frame.sourceKey,
              atSeconds: frame.atSeconds,
              dataUrl: frame.dataUrl,
              sampleKind: frame.sampleKind,
            })),
        }),
      });
      if (response.ok) {
        requestAccepted = true;
        acceptedTraceId = response.headers.get("X-HAYK-Trace-Id");
        if (!overrideIdea) setPrompt("");
        if (acceptedTraceId) {
          setDirectionOperation({
            id: acceptedTraceId,
            traceId: acceptedTraceId,
            status: "processing",
            phase: reuseSavedReferenceAnalysis || direction ? "planning" : "analyzing_reference",
            previousPhase: "submitted",
            providerRequestStarted: true,
            error: null,
            retryable: false,
          });
        }
      }
      const payload = await responsePayload<{ direction?: { id: string; prompt: string; card: DirectorCard }; reused?: boolean }>(response);
      if (!response.ok || !payload.direction) throw new Error(payload.error ?? "HAYK could not prepare the direction.");
      setDirection(payload.direction);
      setDirectionOperation(null);
      setMessages((current) => payload.reused
        ? current.filter((turn) => turn.id !== turnId)
        : current.map((turn) => turn.id === turnId ? { ...turn, status: "sent" } : turn));
      setSelectedShotIds([]);
      setProductionLocked(Boolean(payload.direction.card.lockedAt));
      await refreshProjects(activeProjectId);
    } catch (caught) {
      if (isConnectionInterruption(caught)) {
        setWorkingPhase("directing");
        setUploadStatus("Connection interrupted · recovering the saved director checkpoint without a second AI request…");
        const recovered = await recoverCompletedDirection(activeProjectId, idea, direction?.id);
        if (recovered) {
          setDirection(recovered);
          setMessages((current) => current.map((turn) => turn.id === turnId ? { ...turn, status: "sent" } : turn));
          setSelectedShotIds([]);
          setProductionLocked(Boolean(recovered.card.lockedAt));
          await refreshProjects(activeProjectId);
          return;
        }
      }
      setMessages((current) => current.map((turn) => turn.id === turnId ? { ...turn, status: "failed" } : turn));
      const retryKeys = new Set(turnReferences.map((reference) => reference.key));
      if (!requestAccepted) {
        setReferences((current) => current.map((reference) => retryKeys.has(reference.key)
          ? { ...reference, submitted: false }
          : reference));
      } else if (acceptedTraceId && !isConnectionInterruption(caught)) {
        setDirectionOperation({
          id: acceptedTraceId,
          traceId: acceptedTraceId,
          status: "failed",
          phase: "failed",
          previousPhase: workingPhase ?? "directing",
          providerRequestStarted: true,
          error: caught instanceof Error ? caught.message : "Something interrupted the studio.",
          retryable: true,
        });
      } else if (requestAccepted && acceptedTraceId) {
        resumeProcessing = true;
      }
      setError(isConnectionInterruption(caught)
        ? "The connection ended before HAYK returned the checkpoint. Your change is saved; refresh once to reopen it. No automatic duplicate AI request was made."
        : caught instanceof Error ? caught.message : "Something interrupted the studio.");
    } finally {
      submitInFlightRef.current = false;
      if (resumeProcessing) {
        setBusy(true);
        setWorkingPhase("directing");
        setUploadStatus("Connection interrupted · resuming the durable director operation…");
      } else {
        setBusy(false);
        setUploadStatus(null);
        setWorkingPhase(null);
        setEtaSeconds(null);
      }
    }
  };

  const lockTreatment = async () => {
    if (!direction || !activeProjectId) return;
    setError(null);
    try {
      const response = await fetch("/api/direction", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directionId: direction.id, projectId: activeProjectId, locked: true }),
      });
      const payload = await responsePayload<{ direction?: { id: string; prompt: string; card: DirectorCard } }>(response);
      if (!response.ok || !payload.direction) throw new Error(payload.error ?? "The treatment could not be locked.");
      setDirection(payload.direction);
      setProductionLocked(true);
      await refreshProjects(activeProjectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The treatment could not be locked.");
    }
  };

  const productionPost = async (
    action: string,
    extra: Record<string, unknown> = {},
  ): Promise<ProductionRunPublic> => {
    if (!direction || !activeProjectId) throw new Error("Choose a locked project first.");
    const response = await fetch("/api/production", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: activeProjectId,
        directionId: direction.id,
        action,
        ...extra,
      }),
    });
    const payload = await responsePayload<{ production?: ProductionRunPublic }>(response);
    if (!response.ok || !payload.production) throw new Error(payload.error ?? "The production action could not be completed.");
    setProduction(payload.production);
    return payload.production;
  };

  const buildProductionEvidence = async () => {
    if (!production || !direction || !activeProjectId || productionAction) return;
    setProductionAction("Building the visible AI evidence dossier");
    setProductionError(null);
    setProductionElapsedSeconds(0);
    try {
      const videoReferences = references.filter((reference) => reference.mimeType.startsWith("video/")
        && ["style", "motion", "raw", "patch"].includes(reference.role));
      const perSource = Math.max(4, Math.floor(MAX_LOCAL_STORYBOARD_FRAMES / Math.max(1, videoReferences.length)));
      const frames: ReferenceEvidenceFrame[] = [];
      let boundedWindowUploaded = false;
      for (const reference of videoReferences) {
        const file = await recoverReferenceFile(reference);
        const extracted = await extractStoryboard(
          file,
          reference.id ?? reference.key,
          perSource,
          Math.min(10, direction?.card.deliverySeconds ?? 8),
        );
        frames.push(...extracted.map((frame) => ({
          sourceId: frame.sourceKey,
          atSeconds: frame.atSeconds,
          dataUrl: frame.dataUrl,
          sampleKind: frame.sampleKind,
        })));
        if (!boundedWindowUploaded && direction.card.referenceAnalysis.mode === "inspiration" && reference.id) {
          setProductionAction("Extracting the bounded picture + audio evidence window on this device");
          const window = await extractReferenceWindow(file, Math.min(
            10,
            direction.card.referenceAnalysis.deepPassSeconds,
            direction.card.deliverySeconds,
          ));
          const response = await fetch(`/api/production/evidence-clip?projectId=${encodeURIComponent(activeProjectId!)}&directionId=${encodeURIComponent(direction.id)}&sourceId=${encodeURIComponent(reference.id)}&durationSeconds=${encodeURIComponent(window.durationSeconds.toFixed(2))}`, {
            method: "POST",
            headers: { "Content-Type": window.blob.type || "video/webm" },
            body: window.blob,
          });
          const payload = await responsePayload<{ production?: ProductionRunPublic }>(response);
          if (!response.ok) throw new Error(payload.error ?? "The bounded audiovisual evidence window could not be secured.");
          if (payload.production) setProduction(payload.production);
          boundedWindowUploaded = true;
        }
      }
      setProductionAction("Persisting timeline samples across the full reference");
      await productionPost("ingest_evidence", { frames: frames.slice(0, MAX_LOCAL_STORYBOARD_FRAMES) });
      setProductionAction("Gemini 2.5 Pro is analyzing evidenced picture, timing and sound");
      await productionPost("analyze_evidence");
      await refreshProjects(activeProjectId);
      void refreshConnection();
    } catch (caught) {
      setProductionError(caught instanceof Error ? caught.message : "The evidence dossier could not be completed.");
    } finally {
      setProductionAction(null);
    }
  };

  const approveProductionStage = async (stage: ProductionStage) => {
    if (!production || productionAction) return;
    setProductionAction(`Protecting the approved ${stage} gate`);
    setProductionError(null);
    try {
      await productionPost("approve_stage", { stage });
      await refreshProjects(activeProjectId);
    } catch (caught) {
      setProductionError(caught instanceof Error ? caught.message : "That production gate could not be approved.");
    } finally {
      setProductionAction(null);
    }
  };

  const skipProductionVoice = async () => {
    if (!production || productionAction) return;
    setProductionAction("Protecting the explicit no-voice decision"); setProductionError(null);
    try { await productionPost("skip_voice"); await refreshProjects(activeProjectId); }
    catch (caught) { setProductionError(caught instanceof Error ? caught.message : "The no-voice decision could not be protected."); }
    finally { setProductionAction(null); }
  };

  const skipProductionScore = async () => {
    if (!production || productionAction) return;
    setProductionAction("Protecting the source-shot audio route");
    setProductionError(null);
    try { await productionPost("skip_score"); await refreshProjects(activeProjectId); }
    catch (caught) { setProductionError(caught instanceof Error ? caught.message : "The source-shot audio route could not be protected."); }
    finally { setProductionAction(null); }
  };

  const generateProductionStage = async () => {
    if (!production?.quote || productionAction || imageStageHasWorkingArtifact || productionStageInFlightRef.current) return;
    const stage = production.currentStage;
    if (!["identity", "storyboard", "motion", "score"].includes(stage)) return;
    productionStageInFlightRef.current = true;
    setProductionAction(stage === "motion" ? "Submitting independent Seedance 2.5 source shots" : stage === "score" ? "Lyria is composing the separately approved score" : "Generating visible production frames");
    setProductionError(null);
    setProductionElapsedSeconds(0);
    try {
      let latest = production;
      if (production.approvedCostUsd === null) {
        latest = await productionPost("approve_budget", {
          stage,
          approvedMaxCostUsd: production.quote.maxCostUsd,
        });
      }
      if (stage === "motion") {
        while (latest.artifacts.some((artifact) => artifact.stage === "motion" && artifact.status === "planned")) {
          latest = await productionPost("submit_next_motion");
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
        if (!latest.tasks.some((task) => !["completed", "failed", "cancelled", "expired"].includes(task.status))) {
          setProductionAction(null);
        }
      } else if (stage === "score") {
        latest = await productionPost("submit_score");
        if (!latest.tasks.some((task) => !["completed", "failed", "cancelled", "expired"].includes(task.status))) setProductionAction(null);
      } else {
        while (latest.artifacts.some((artifact) => artifact.stage === stage && artifact.status === "planned")) {
          latest = await productionPost("generate_next_image");
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
        setProductionAction(null);
        void refreshConnection();
      }
      await refreshProjects(activeProjectId);
    } catch (caught) {
      setProductionAction(null);
      setProductionError(caught instanceof Error ? caught.message : "This production stage stopped safely.");
      if (direction && activeProjectId) void loadProductionRoute(direction.id, activeProjectId);
    } finally {
      productionStageInFlightRef.current = false;
    }
  };

  const assembleProductionCut = async () => {
    if (!production || !direction || !activeProjectId || productionAction) return;
    setProductionAction("Assembling the locked edit and synchronized source audio");
    setProductionError(null);
    setProductionElapsedSeconds(0);
    setAssemblyProgress("Preparing the edit room…");
    try {
      const shots = shotsFor(direction.card);
      const blob = await assembleSourceShots(production.artifacts, shots, (completed, total) => {
        setAssemblyProgress(`Assembling source shot ${completed} of ${total}`);
      });
      setAssemblyProgress("Securing the assembled director cut…");
      const response = await fetch(`/api/production/master?runId=${encodeURIComponent(production.id)}&projectId=${encodeURIComponent(activeProjectId)}&directionId=${encodeURIComponent(direction.id)}`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "video/webm" },
        body: blob,
      });
      const payload = await responsePayload<{ production?: ProductionRunPublic }>(response);
      if (!response.ok || !payload.production) throw new Error(payload.error ?? "The assembled cut could not be secured.");
      setProduction(payload.production);
      await refreshProjects(activeProjectId);
    } catch (caught) {
      setProductionError(caught instanceof Error ? caught.message : "The deterministic edit stopped safely.");
    } finally {
      setAssemblyProgress(null);
      setProductionAction(null);
    }
  };

  const runContinuityQc = async () => {
    if (!production || productionAction) return;
    setProductionAction("Running multimodal continuity and identity QC");
    setProductionError(null);
    setProductionElapsedSeconds(0);
    try {
      await productionPost("run_qc");
      await refreshProjects(activeProjectId);
      void refreshConnection();
    } catch (caught) {
      setProductionError(caught instanceof Error ? caught.message : "Continuity QC stopped safely.");
    } finally {
      setProductionAction(null);
    }
  };

  const prepareFailedArtifactRetry = async (artifactId: string) => {
    if (!production || productionAction) return;
    const failed = production.artifacts.find((artifact) => artifact.id === artifactId);
    const reusesApproval = failed?.metadata.interruptedRequest === true && failed?.metadata.retryUsesExistingApproval === true;
    setProductionAction(reusesApproval ? "Preparing one manual retry under the existing approval" : "Preparing a new explicit quote for the failed artifact");
    setProductionError(null);
    try {
      await productionPost("reset_failed_artifact", { artifactId });
    } catch (caught) {
      setProductionError(caught instanceof Error ? caught.message : "The failed artifact could not be prepared for a manual retry.");
    } finally {
      setProductionAction(null);
    }
  };

  const onRegenerateShot = async (shotId: string) => {
    if (!production) return;
    setProductionAction(`Regenerating shot ${shotId}...`);
    setProductionError(null);
    try {
      await productionPost("regenerate_shot", { shotId });
    } catch (caught) {
      setProductionError(caught instanceof Error ? caught.message : `Could not regenerate shot ${shotId}.`);
    } finally {
      setProductionAction(null);
    }
  };

  const approveSection = async (section: ApprovalSection) => {
    if (!direction || !activeProjectId || busy) return;
    setBusy(true);
    setError(null);
    if (section === "language") {
      setWorkingPhase("directing");
      setEtaSeconds(35);
      setUploadStatus("Building the bounded shot graph from the approved concept and visual world · no media render…");
    }
    try {
      const response = await fetch("/api/direction", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directionId: direction.id, projectId: activeProjectId, approveStep: section }),
      });
      const payload = await responsePayload<{ direction?: { id: string; prompt: string; card: DirectorCard } }>(response);
      if (!response.ok || !payload.direction) throw new Error(payload.error ?? "That section could not be approved.");
      setDirection(payload.direction);
      setSelectedShotIds([]);
      await refreshProjects(activeProjectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That section could not be approved.");
    } finally {
      setBusy(false);
      if (section === "language") {
        setWorkingPhase(null);
        setEtaSeconds(null);
        setUploadStatus(null);
      }
    }
  };

  const analyzeReferenceStoryboard = async () => {
    if (!direction || !activeProjectId || busy) return;
    const videoSources = references.filter((reference) =>
      reference.id && reference.mimeType.startsWith("video/") && ["style", "motion", "raw", "patch"].includes(reference.role),
    );
    if (!videoSources.length) {
      setError("No visual-reference video is available for analysis.");
      return;
    }
    setBusy(true);
    setError(null);
    setWorkingPhase("mapping");
    setEtaSeconds(estimatedDirectionSeconds(videoSources, false));
    setUploadStatus("Reopening the saved reference and sampling it locally · no full-video API charge…");
    try {
      const perVideo = Math.max(1, Math.floor(MAX_LOCAL_STORYBOARD_FRAMES / videoSources.length));
      const storyboardFrames: StoryboardFrame[] = [];
      for (const source of videoSources) {
        const file = await recoverReferenceFile(source);
        storyboardFrames.push(...await extractStoryboard(file, source.id!, perVideo, direction.card.referenceAnalysis.deepPassSeconds));
        if (storyboardFrames.length >= MAX_LOCAL_STORYBOARD_FRAMES) break;
      }
      if (!storyboardFrames.length) throw new Error("The reference video could not be sampled. Nothing was approved.");
      setWorkingPhase("directing");
      setUploadStatus("HAYK is reading the sampled frames and rebuilding the visual world…");
      const response = await fetch("/api/direction", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directionId: direction.id,
          projectId: activeProjectId,
          reanalyzeReferences: true,
          storyboardFrames: storyboardFrames.slice(0, MAX_LOCAL_STORYBOARD_FRAMES).map((frame) => ({
            sourceId: frame.sourceKey,
            atSeconds: frame.atSeconds,
            dataUrl: frame.dataUrl,
            sampleKind: frame.sampleKind,
          })),
        }),
      });
      const payload = await responsePayload<{ direction?: { id: string; prompt: string; card: DirectorCard } }>(response);
      if (!response.ok || !payload.direction) throw new Error(payload.error ?? "The visual reference could not be analyzed.");
      setDirection(payload.direction);
      await refreshProjects(activeProjectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The visual reference could not be analyzed.");
    } finally {
      setBusy(false);
      setUploadStatus(null);
      setWorkingPhase(null);
      setEtaSeconds(null);
    }
  };

  const createProject = async () => {
    if (projectBusy || busy) return;
    setProjectBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled film" }),
      });
      const payload = await responsePayload<{ project?: ProjectSummary }>(response);
      if (!response.ok || !payload.project) throw new Error(payload.error ?? "A new project could not be created.");
      setProjects((current) => [payload.project!, ...current]);
      setActiveProjectId(payload.project.id);
      setProjectDialogOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A new project could not be created.");
    } finally {
      setProjectBusy(false);
    }
  };

  const renameProject = async () => {
    if (!renameTarget || !renameValue.trim() || projectBusy || busy) return;
    setProjectBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: renameTarget.id, name: renameValue.trim() }),
      });
      const payload = await responsePayload<{ project?: ProjectSummary }>(response);
      if (!response.ok) throw new Error(payload.error ?? "The project could not be renamed.");
      setProjects((current) => current.map((project) => project.id === renameTarget.id ? { ...project, name: renameValue.trim() } : project));
      setRenameTarget(null);
      setRenameValue("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The project could not be renamed.");
    } finally {
      setProjectBusy(false);
    }
  };

  const deleteProject = async (projectId: string) => {
    if (projectBusy || busy) return;
    setProjectBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const payload = await responsePayload<{ deleted?: boolean }>(response);
      if (!response.ok || !payload.deleted) throw new Error(payload.error ?? "The project could not be deleted.");
      const remaining = projects.filter((project) => project.id !== projectId);
      setProjects(remaining);
      if (activeProjectId === projectId) {
        setActiveProjectId(remaining[0]?.id ?? null);
        if (!remaining.length) await refreshProjects(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The project could not be deleted.");
    } finally {
      setProjectBusy(false);
    }
  };

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const conceptRevision = Boolean(direction?.card.revisionPlan && (direction.card.approvalStage ?? "concept") === "concept");
  const stage = conceptRevision
    ? "Concept revision"
    : direction?.card.revisionPlan
      ? "Surgical edit"
    : production?.currentStage === "master"
      ? "Master"
      : production
        ? productionStageLabel(production.currentStage)
    : productionLocked
      ? "Production ready"
      : direction
        ? activeProject?.stage ?? "Treatment"
        : "Idea";
  const detectedLink = URL_PATTERN.test(prompt);

  return (
    <div className="min-h-screen bg-[#080907] text-foreground selection:bg-primary/25">
      <StudioHeader userName={userName} connection={connection} mediaWorker={mediaWorker} syncLabs={syncLabs} onSyncLabsChange={refreshSyncLabs} onMediaWorkerChange={refreshMediaWorker} onDisconnect={async () => {
        await fetch("/api/openrouter/disconnect", { method: "POST" });
        void refreshConnection();
      }} />

      <main className="mx-auto grid max-w-[1600px] lg:grid-cols-[268px_minmax(0,1fr)]">
        <StudioRail
          projects={projects}
          activeProjectId={activeProjectId}
          projectBusy={projectBusy || busy}
          onSelect={setActiveProjectId}
          onNew={() => void createProject()}
          onRename={(project) => { setRenameTarget(project); setRenameValue(project.name); }}
          onDelete={(projectId) => void deleteProject(projectId)}
        />

        <section className="relative min-w-0 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 studio-grid opacity-60" />
          <div className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-primary/[0.035] blur-[120px]" />
          <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1080px] flex-col px-3 pb-5 pt-5 sm:px-7 sm:pt-8">
            <RoomHeading userName={userName} stage={stage} autonomy={autonomy} setAutonomy={setAutonomy} />
            <MobileProjectSwitcher
              projects={projects}
              activeProjectId={activeProjectId}
              open={projectDialogOpen}
              setOpen={setProjectDialogOpen}
              projectBusy={projectBusy || busy}
              onSelect={setActiveProjectId}
              onNew={() => void createProject()}
              onRename={(project) => { setRenameTarget(project); setRenameValue(project.name); setProjectDialogOpen(false); }}
              onDelete={(projectId) => void deleteProject(projectId)}
            />

            <div className="flex-1 space-y-6 pb-4">
              <HaykWelcome hasDirection={Boolean(direction)} setPrompt={setPrompt} />

              {messages.map((message) => <ChatTurnBubble key={message.id} turn={message} />)}

              {busy && <DirectorWorkingBubble phase={workingPhase} etaSeconds={etaSeconds} detail={uploadStatus} isRevision={Boolean(direction)} />}

              {direction && !busy && (
                <DirectorReply
                  direction={direction}
                  mediaWorker={mediaWorker}
                  references={references}
                  selectedShotIds={selectedShotIds}
                  onSelectShot={(shotId) => setSelectedShotIds((current) => current.includes(shotId)
                    ? current.filter((id) => id !== shotId)
                    : [...current, shotId].sort())}
                  productionLocked={productionLocked}
                  onLock={lockTreatment}
                  onApprove={(section) => void approveSection(section)}
                  onAnalyzeReferences={() => void analyzeReferenceStoryboard()}
                  onUpgradeConcept={() => void submitBrief(direction.prompt, "Upgrade concept intelligence")}
                  production={production}
                  productionLoading={productionLoading}
                  productionAction={productionUiAction}
                  productionElapsedSeconds={productionElapsedSeconds}
                  assemblyProgress={assemblyProgress}
                  productionError={productionError}
                  onBuildEvidence={() => void buildProductionEvidence()}
                  onApproveProductionStage={(productionStage) => void approveProductionStage(productionStage)}
                  onSkipProductionVoice={() => void skipProductionVoice()}
                  onSkipProductionScore={() => void skipProductionScore()}
                  onGenerateProductionStage={() => void generateProductionStage()}
                  onAssemble={() => void assembleProductionCut()}
                  onRunQc={() => void runContinuityQc()}
                  onResetFailedArtifact={(artifactId) => void prepareFailedArtifactRetry(artifactId)}
                  onRefreshProduction={() => void loadProductionRoute(direction.id, activeProjectId!)}
                  onDecision={(decision, option) => void submitBrief(
                    `Decision ${decision.id}: ${option}. Preserve every other approved creative choice.`,
                    `${decision.id === "voiceover" ? "Voiceover" : "Music & sound"}: ${option}`,
                  )}
                />
              )}

              {error && <div className="ml-0 rounded-2xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive sm:ml-11">{error}</div>}
            </div>

            <Composer
              prompt={prompt}
              setPrompt={setPrompt}
              references={pendingReferences}
              busy={busy || projectsLoading || !activeProjectId}
              hasDirection={Boolean(direction)}
              selectedShotIds={selectedShotIds}
              detectedLink={detectedLink}
              recording={recording}
              inputRef={inputRef}
              addFiles={addFiles}
              onRemove={removeReference}
              onRole={(key, role) => setReferences((current) => current.map((item) => item.key === key ? { ...item, role } : item))}
              onSubmit={submitBrief}
              onRecord={() => void startOrStopRecording()}
              onClearTarget={() => setSelectedShotIds([])}
            />
          </div>
        </section>
      </main>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => { if (!open) { setRenameTarget(null); setRenameValue(""); } }}>
        <DialogContent className="border-white/10 bg-[#12130f] sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>The folder name changes. Its film, assets and approvals stay untouched.</DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            value={renameValue}
            maxLength={80}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void renameProject(); }}
            className="h-11 rounded-xl border border-white/10 bg-black/25 px-3 text-sm outline-none focus:border-primary/35"
          />
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button disabled={!renameValue.trim() || projectBusy} onClick={() => void renameProject()} className="bg-primary text-primary-foreground hover:bg-primary/90">Save name</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StudioHeader({ userName, connection, mediaWorker, syncLabs, onDisconnect, onMediaWorkerChange, onSyncLabsChange }: {
  userName: string;
  connection: ConnectionState;
  mediaWorker: MediaWorkerState;
  syncLabs: SyncState;
  onDisconnect: () => void;
  onMediaWorkerChange: () => void;
  onSyncLabsChange: () => void;
}) {
  const [workerDialogOpen, setWorkerDialogOpen] = useState(false);
  const [workerUrl, setWorkerUrl] = useState(mediaWorker.url ?? "https://hayk-media-worker-mtelkuekba-ew.a.run.app");
  const [workerSecret, setWorkerSecret] = useState("");
  const [workerBusy, setWorkerBusy] = useState(false);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncKey, setSyncKey] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [openRouterDialogOpen, setOpenRouterDialogOpen] = useState(false);
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [openRouterBusy, setOpenRouterBusy] = useState(false);
  const [openRouterError, setOpenRouterError] = useState<string | null>(null);

  const connectWorker = async () => {
    setWorkerBusy(true);
    setWorkerError(null);
    try {
      const response = await fetch("/api/media-worker/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: workerUrl, secret: workerSecret }),
      });
      const payload = await responsePayload<{ configured?: boolean }>(response);
      if (!response.ok || !payload.configured) throw new Error(payload.error ?? "The worker could not be connected.");
      setWorkerSecret("");
      setWorkerDialogOpen(false);
      onMediaWorkerChange();
    } catch (caught) {
      setWorkerError(caught instanceof Error ? caught.message : "The worker could not be connected.");
    } finally {
      setWorkerBusy(false);
    }
  };

  const connectSync = async () => {
    setSyncBusy(true); setSyncError(null);
    try {
      const response = await fetch("/api/sync/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: syncKey }) });
      const payload = await responsePayload<{ connected?: boolean }>(response);
      if (!response.ok || !payload.connected) throw new Error(payload.error ?? "Sync Labs could not be connected.");
      setSyncKey(""); setSyncDialogOpen(false); onSyncLabsChange();
    } catch (caught) { setSyncError(caught instanceof Error ? caught.message : "Sync Labs could not be connected."); }
    finally { setSyncBusy(false); }
  };

  const connectOpenRouter = async () => {
    setOpenRouterBusy(true);
    setOpenRouterError(null);
    try {
      const response = await fetch("/api/openrouter/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: openRouterKey }),
      });
      const payload = await responsePayload<{ connected?: boolean }>(response);
      if (!response.ok || !payload.connected) throw new Error(payload.error ?? "OpenRouter could not verify this key.");
      setOpenRouterKey("");
      setOpenRouterDialogOpen(false);
      window.location.reload();
    } catch (caught) {
      setOpenRouterError(caught instanceof Error ? caught.message : "OpenRouter could not verify this key.");
    } finally {
      setOpenRouterBusy(false);
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-[#080907]/90 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-7">
        <div className="flex items-center gap-3">
          <div className="relative grid size-9 place-items-center rounded-[13px] border border-primary/25 bg-primary/10 text-primary shadow-[0_0_30px_rgba(217,255,87,0.08)]">
            <Sparkles className="size-4" />
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-[#080907] bg-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-[0.08em]">HAYK</span>
              <Badge variant="outline" className="h-5 border-white/10 bg-white/3 px-2 text-[9px] tracking-[0.12em] text-muted-foreground">CREATIVE DIRECTOR</Badge>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">NUMU cinematic production system</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={syncDialogOpen} onOpenChange={(open) => { setSyncDialogOpen(open); setSyncError(null); }}>
            <DialogTrigger asChild><button type="button" className={`hidden items-center gap-2 rounded-full border px-3 py-2 text-[10px] md:flex ${syncLabs.connected ? "border-[#9db2ff]/25 bg-[#9db2ff]/[0.07] text-[#b8c5ff]" : "border-white/10 bg-white/[0.03] text-muted-foreground"}`}><span className={`size-1.5 rounded-full ${syncLabs.connected ? "bg-[#9db2ff]" : "bg-white/25"}`} />{syncLabs.loading ? "Checking performance" : syncLabs.connected ? "Sync-3 ready" : "Connect lip-sync"}</button></DialogTrigger>
            <DialogContent className="border-white/10 bg-[#12130f] sm:max-w-lg"><DialogHeader><DialogTitle>Connect Sync Labs performance</DialogTitle><DialogDescription className="leading-6">Paste the API key here—not in chat. HAYK verifies it server-side, encrypts it in a secure private cookie, and never displays it again.</DialogDescription></DialogHeader><div className="space-y-4 py-2"><label className="block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Sync Labs API key<input type="password" value={syncKey} onChange={(event) => setSyncKey(event.target.value)} placeholder="Enter the key from sync.so" autoComplete="off" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm normal-case tracking-normal outline-none focus:border-[#9db2ff]/40" /></label><div className="rounded-xl border border-[#9db2ff]/18 bg-[#9db2ff]/[0.045] p-3 text-[10px] leading-5 text-muted-foreground"><span className="font-medium text-[#b8c5ff]">Test route: sync-3.</span> Native 4K face output, identity and emotional-performance preservation, visible progress, and no automatic retry.</div>{syncError && <p className="text-xs text-destructive">{syncError}</p>}</div><DialogFooter><DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose><Button disabled={syncBusy || !syncKey.trim()} onClick={() => void connectSync()} className="bg-[#9db2ff] text-[#10131c] hover:bg-[#b8c5ff]">{syncBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />} Verify and connect</Button></DialogFooter></DialogContent>
          </Dialog>
          <Dialog open={workerDialogOpen} onOpenChange={(open) => { setWorkerDialogOpen(open); setWorkerError(null); }}>
            <DialogTrigger asChild>
              <button type="button" className={`hidden items-center gap-2 rounded-full border px-3 py-2 text-[10px] sm:flex ${mediaWorker.productionReady ? "border-primary/18 bg-primary/[0.07] text-primary" : mediaWorker.online ? "border-[#d9a36c]/25 bg-[#d9a36c]/[0.07] text-[#e1b47c]" : "border-white/10 bg-white/[0.03] text-muted-foreground"}`}>
                <span className={`size-1.5 rounded-full ${mediaWorker.productionReady ? "bg-primary" : mediaWorker.online ? "bg-[#d9a36c]" : "bg-white/25"}`} />
                {mediaWorker.loading ? "Checking worker" : mediaWorker.productionReady ? "Finishing ready" : mediaWorker.online ? "Worker foundation" : "Connect worker"}
              </button>
            </DialogTrigger>
            <DialogContent className="border-white/10 bg-[#12130f] sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Connect the Google Cloud machine room</DialogTitle>
                <DialogDescription className="leading-6">The secret travels directly from this private form to HAYK and is stored as an encrypted, secure cookie. It is never displayed again.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <label className="block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Worker URL<input value={workerUrl} onChange={(event) => setWorkerUrl(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm normal-case tracking-normal outline-none focus:border-primary/35" /></label>
                <label className="block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Connection secret<input type="password" value={workerSecret} onChange={(event) => setWorkerSecret(event.target.value)} placeholder="Paste the secret shown by Cloud Shell" autoComplete="off" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm normal-case tracking-normal outline-none focus:border-primary/35" /></label>
                {mediaWorker.online && <div className="rounded-xl border border-[#d9a36c]/18 bg-[#d9a36c]/[0.045] p-3 text-[10px] leading-5 text-muted-foreground"><span className="font-medium text-[#e1b47c]">Worker online.</span> The editing foundation is installed. Full finishing remains blocked until ACES, five true stems, voice conversion and performance lip-sync pass verification.</div>}
                {workerError && <p className="text-xs text-destructive">{workerError}</p>}
              </div>
              <DialogFooter><DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose><Button disabled={workerBusy || !workerSecret.trim() || !workerUrl.trim()} onClick={() => void connectWorker()} className="bg-primary text-primary-foreground hover:bg-primary/90">{workerBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />} Verify and connect</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          {connection.connected ? (
            <div className="group flex items-center gap-2 rounded-full border border-primary/18 bg-primary/[0.07] px-3 py-2 text-[11px] text-primary">
              <span className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(217,255,87,0.8)]" />
              <span className="hidden sm:inline">Studio connected</span>
              {connection.remainingUsd !== null && <span className="text-primary/60">${connection.remainingUsd.toFixed(2)}</span>}
              <button type="button" onClick={onDisconnect} className="hidden text-primary/40 hover:text-primary group-hover:block" aria-label="Disconnect studio billing"><Unplug className="size-3.5" /></button>
            </div>
          ) : (
            <Dialog open={openRouterDialogOpen} onOpenChange={(open) => { setOpenRouterDialogOpen(open); setOpenRouterError(null); }}>
              <DialogTrigger asChild><Button size="sm" className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"><Link2 className="size-3.5" /> Connect studio</Button></DialogTrigger>
              <DialogContent className="border-white/10 bg-[#12130f] sm:max-w-lg">
                <DialogHeader><DialogTitle>Reconnect OpenRouter</DialogTitle><DialogDescription className="leading-6">Paste an OpenRouter API key here—not in chat. HAYK verifies it server-side, encrypts it in a secure private cookie, and never displays it again.</DialogDescription></DialogHeader>
                <div className="space-y-4 py-2">
                  <label className="block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">OpenRouter API key<input type="password" value={openRouterKey} onChange={(event) => setOpenRouterKey(event.target.value)} placeholder="sk-or-v1-…" autoComplete="off" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm normal-case tracking-normal outline-none focus:border-primary/35" /></label>
                  <div className="rounded-xl border border-primary/15 bg-primary/[0.04] p-3 text-[10px] leading-5 text-muted-foreground">The direct key form is the reliable recovery route after a disconnect. OpenRouter authorization remains available if you prefer HAYK to create a separate app key.</div>
                  {openRouterError && <p className="text-xs text-destructive">{openRouterError}</p>}
                </div>
                <DialogFooter className="sm:justify-between"><Button asChild variant="ghost"><a href="/api/openrouter/connect">Use OpenRouter authorization</a></Button><div className="flex gap-2"><DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose><Button disabled={openRouterBusy || !openRouterKey.trim()} onClick={() => void connectOpenRouter()} className="bg-primary text-primary-foreground hover:bg-primary/90">{openRouterBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />} Verify and reconnect</Button></div></DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          <div className="grid size-8 place-items-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold">{userName.slice(0, 1).toUpperCase()}</div>
        </div>
      </div>
    </header>
  );
}

function StudioRail({
  projects,
  activeProjectId,
  projectBusy,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  projectBusy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (project: ProjectSummary) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="hidden min-h-[calc(100vh-4rem)] border-r border-white/8 bg-[#0a0b09] p-5 lg:block">
      <Button variant="outline" disabled={projectBusy} className="mb-6 h-11 w-full justify-start rounded-xl border-white/10 bg-white/[0.025] hover:bg-white/6" onClick={onNew}><Folder className="size-4" /> New project</Button>
      <div className="mb-3 flex items-center justify-between px-2">
        <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">PROJECT FOLDERS</p>
        <span className="text-[9px] text-muted-foreground/60">{projects.length}</span>
      </div>
      <ProjectList projects={projects} activeProjectId={activeProjectId} projectBusy={projectBusy} onSelect={onSelect} onRename={onRename} onDelete={onDelete} />

      <div className="mt-8 rounded-2xl border border-white/8 bg-[#0e0f0d] p-4">
        <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /><p className="text-xs font-medium">Workspace memory</p></div>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">Brand truth, products, audiences and approved assets will remain above every individual film.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["Brand", "Offer", "Audience", "Tone"].map((item) => <span key={item} className="rounded-full border border-white/8 bg-white/3 px-2 py-1 text-[9px] text-muted-foreground">{item}</span>)}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-primary/15 bg-primary/[0.05] p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-primary"><Scissors className="size-4" /> Surgical by default</div>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">HAYK changes the smallest shot or layer. The full film restarts only when you ask.</p>
      </div>
    </aside>
  );
}

function ProjectList({ projects, activeProjectId, projectBusy, onSelect, onRename, onDelete }: {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  projectBusy: boolean;
  onSelect: (id: string) => void;
  onRename: (project: ProjectSummary) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {projects.map((project) => {
        const selected = project.id === activeProjectId;
        return (
          <div key={project.id} className={`group rounded-2xl border transition ${selected ? "border-primary/20 bg-primary/[0.07]" : "border-white/7 bg-white/[0.02] hover:border-white/13"}`}>
            <button type="button" disabled={projectBusy} onClick={() => onSelect(project.id)} className="flex w-full items-start gap-3 px-3 pb-2 pt-3 text-left">
              <div className={`grid size-8 shrink-0 place-items-center rounded-xl ${selected ? "bg-primary/12 text-primary" : "bg-white/5 text-muted-foreground"}`}>
                {selected ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{project.name}</p>
                <p className="mt-1 truncate text-[9px] text-muted-foreground">{project.referenceCount} assets · {project.stage}</p>
              </div>
            </button>
            <div className="flex items-center justify-end gap-1 border-t border-white/6 px-2 py-1.5">
              <button type="button" disabled={projectBusy} onClick={() => onRename(project)} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-white/6 hover:text-foreground" aria-label={`Rename ${project.name}`}><Pencil className="size-3" /></button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button type="button" disabled={projectBusy} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${project.name}`}><Trash2 className="size-3" /></button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-white/10 bg-[#12130f]">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
                    <AlertDialogDescription>This permanently removes only this project’s conversation, references and generated media. Other project folders stay untouched.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep project</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDelete(project.id)} className="bg-destructive text-white hover:bg-destructive/90">Delete project</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MobileProjectSwitcher({ projects, activeProjectId, open, setOpen, projectBusy, onSelect, onNew, onRename, onDelete }: {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  projectBusy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (project: ProjectSummary) => void;
  onDelete: (id: string) => void;
}) {
  const active = projects.find((project) => project.id === activeProjectId);
  return (
    <div className="mb-6 lg:hidden">
      <Button variant="outline" onClick={() => setOpen(true)} className="h-auto w-full justify-between rounded-2xl border-white/10 bg-white/[0.025] px-3 py-3">
        <span className="flex min-w-0 items-center gap-3 text-left"><FolderOpen className="size-4 shrink-0 text-primary" /><span className="min-w-0"><span className="block truncate text-xs">{active?.name ?? "Choose project"}</span><span className="mt-0.5 block text-[9px] font-normal text-muted-foreground">{active ? `${active.referenceCount} assets · ${active.stage}` : "Project folder"}</span></span></span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[82vh] overflow-y-auto border-white/10 bg-[#12130f]">
          <DialogHeader><DialogTitle>Project folders</DialogTitle><DialogDescription>Each project has its own conversation, assets, approvals and versions.</DialogDescription></DialogHeader>
          <Button variant="outline" disabled={projectBusy} onClick={onNew} className="h-11 justify-start rounded-xl border-white/10"><Plus className="size-4" /> New project</Button>
          <ProjectList projects={projects} activeProjectId={activeProjectId} projectBusy={projectBusy} onSelect={(id) => { onSelect(id); setOpen(false); }} onRename={onRename} onDelete={onDelete} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoomHeading({ userName, stage, autonomy, setAutonomy }: { userName: string; stage: string; autonomy: Autonomy; setAutonomy: (value: Autonomy) => void }) {
  return (
    <div className="mb-7 flex items-end justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold tracking-[0.22em] text-primary/75">CREATIVE ROOM · {stage.toUpperCase()}</p>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.035em] sm:text-[32px]">Bring me the thought, {userName}.</h1>
      </div>
      <Select value={autonomy} onValueChange={(value) => setAutonomy(value as Autonomy)}>
        <SelectTrigger className="h-9 w-[142px] rounded-full border-white/10 bg-white/3 px-3 text-[11px] shadow-none"><SelectValue /></SelectTrigger>
        <SelectContent className="border-white/10 bg-[#161713]">
          <SelectItem value="Autopilot">Autopilot</SelectItem>
          <SelectItem value="Collaborative">Collaborative</SelectItem>
          <SelectItem value="Expert">Expert</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function HaykWelcome({ hasDirection, setPrompt }: { hasDirection: boolean; setPrompt: (value: string) => void }) {
  return (
    <div className="flex gap-3">
      <HaykAvatar />
      <div className="max-w-[760px] rounded-[22px] rounded-tl-md border border-white/8 bg-[#11120f]/95 px-4 py-4 text-sm leading-6 text-[#d8d7d0] shadow-2xl shadow-black/10 sm:px-5">
        {hasDirection
          ? "We’ll approve this film one checkpoint at a time. You will see only the current decision; anything already approved stays protected. Use the chat whenever you want to change that section."
          : "This project is empty. Step 1: share the idea and any references. I’ll return only the core concept for approval—camera, shots and sound stay hidden until their turn."}
        {!hasDirection && (
          <div className="mt-4 flex flex-wrap gap-2">
            <PromptSeed label="Create a perfume film" onClick={() => setPrompt(PERFUME_PROMPT)} />
            <PromptSeed label="Transform raw footage" onClick={() => setPrompt("Transform this raw footage into a premium brand film. Preserve what is real and redesign only what improves the story.")} />
            <PromptSeed label="Continue a previous film" onClick={() => setPrompt("Create a new version of my previous film. Keep the locked world and let HAYK choose the strongest new concept.")} />
          </div>
        )}
      </div>
    </div>
  );
}

function PromptSeed({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="rounded-full border border-white/10 bg-white/3 px-3 py-1.5 text-[11px] text-[#bebdb5] transition hover:border-primary/25 hover:bg-primary/8 hover:text-primary">{label}</button>;
}

function HaykAvatar() {
  return <div className="grid size-8 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/8 text-primary shadow-[0_0_24px_rgba(217,255,87,0.05)]"><Sparkles className="size-4" /></div>;
}

function ChatTurnBubble({ turn }: { turn: ChatTurn }) {
  return (
    <div className="flex justify-end">
      <div className="w-fit max-w-[820px] overflow-hidden rounded-[22px] rounded-tr-md border border-white/7 bg-[#25271f] text-[#f1efe8] shadow-lg shadow-black/10">
        {turn.references.length > 0 && (
          <div className="flex max-w-[820px] gap-2 overflow-x-auto border-b border-white/7 p-2.5 scrollbar-thin">
            {turn.references.map((reference) => {
              const isImage = reference.mimeType.startsWith("image/");
              const isVideo = reference.mimeType.startsWith("video/");
              return (
                <div key={reference.key} className="w-[128px] shrink-0 overflow-hidden rounded-xl border border-white/8 bg-black/20">
                  <div className="h-[72px] bg-[#171813]">
                    {isImage && reference.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={reference.previewUrl} alt="" className="h-full w-full object-cover" />
                    ) : isVideo && reference.previewUrl ? (
                      <video src={reference.previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center text-primary/55">{isVideo ? <Video className="size-5" /> : <Music className="size-5" />}</div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-[9px] font-medium">{reference.filename}</p>
                    <p className="mt-1 truncate text-[8px] text-primary/65">{ROLE_LABELS[reference.role]}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="px-4 py-3">
          <p className="text-sm leading-6">{humanMessage(turn.text)}</p>
          <div className="mt-2 flex items-center justify-end gap-1.5 text-[8px] text-muted-foreground">
            {turn.status === "failed" ? <span className="text-destructive">Interrupted · references remain saved</span> : turn.status === "sending" ? <span>Submitted</span> : <><ShieldCheck className="size-2.5 text-primary/60" /><span>Saved in film history</span></>}
          </div>
        </div>
      </div>
    </div>
  );
}

function DirectorWorkingBubble({ phase, etaSeconds, detail, isRevision }: { phase: WorkingPhase; etaSeconds: number | null; detail: string | null; isRevision: boolean }) {
  const phaseIndex = phase === "reading" ? 0 : phase === "mapping" || phase === "uploading" ? 1 : 2;
  const steps = isRevision
    ? ["Reading your change", "Protecting the approved master", "Planning the smallest patch"]
    : ["Reading the idea", "Mapping and securing references", "Directing the treatment"];
  return (
    <div className="flex gap-3" role="status" aria-live="polite">
      <HaykAvatar />
      <div className="hayk-arrive w-full max-w-[720px] rounded-[22px] rounded-tl-md border border-primary/15 bg-[#11120f] px-4 py-4 shadow-2xl shadow-black/15 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span>HAYK is directing the treatment</span>
              <span className="flex items-end gap-1" aria-hidden="true">
                {[0, 1, 2].map((index) => <span key={index} className="size-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${index * 140}ms` }} />)}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">{detail ?? "Building a precise, replaceable shot plan from your idea and evidence."}</p>
          </div>
          <div className="rounded-xl border border-primary/15 bg-primary/[0.06] px-3 py-2 text-right">
            <p className="text-[8px] uppercase tracking-[0.12em] text-primary/55">Estimated remaining</p>
            <p className="mt-0.5 font-mono text-sm text-primary">{countdownLabel(etaSeconds)}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {steps.map((step, index) => (
            <div key={step} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[9px] ${index < phaseIndex ? "border-primary/10 bg-primary/[0.035] text-primary/65" : index === phaseIndex ? "border-primary/25 bg-primary/[0.08] text-primary" : "border-white/6 bg-white/[0.02] text-muted-foreground/55"}`}>
              {index < phaseIndex ? <Check className="size-3" /> : index === phaseIndex ? <LoaderCircle className="size-3 animate-spin" /> : <span className="size-3 rounded-full border border-white/15" />}
              <span>{step}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[8px] text-muted-foreground/65"><ShieldCheck className="size-3 text-primary/55" /> Direction analysis only · typically below $0.01 · no video generation</p>
      </div>
    </div>
  );
}

function ReferenceIntelligencePanel({ plan, intelligence }: { plan: ReferenceAnalysisPlan; intelligence: ReferenceIntelligence }) {
  const modeLabel = plan.mode === "source-edit" ? "Edit original" : plan.mode === "close-adaptation" ? "Close adaptation" : "Inspiration";
  return (
    <div className="border-b border-white/8 bg-[linear-gradient(135deg,rgba(74,111,255,0.055),rgba(217,255,87,0.025))] px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#9db2ff]"><Film className="size-4" /> Reference intelligence</div>
          <p className="mt-2 max-w-3xl text-[11px] leading-5 text-[#bdbcb5]">{plan.strategy}</p>
        </div>
        <Badge variant="outline" className="border-[#8da4ff]/20 bg-[#8da4ff]/8 text-[#b8c5ff]">{modeLabel} · {intelligence.status}</Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Reference" value={plan.longestSourceSeconds ? compactDuration(plan.longestSourceSeconds) ?? "Known" : plan.localStoryboardFrames ? "Video sampled" : "Still"} />
        <Metric label="Final film" value={`${plan.requestedRuntimeSeconds}s`} accent />
        <Metric label="Local map" value={`${plan.localStoryboardFrames} frames`} />
        <Metric label="Full video billed" value={`${plan.fullVideoSecondsSent}s`} accent />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-white/7 bg-black/15 p-3">
          <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Authority order</p>
          <div className="mt-2 space-y-1.5">{plan.authorityOrder.map((rule) => <p key={rule} className="flex gap-2 text-[10px] leading-4 text-[#aaa9a1]"><Check className="mt-0.5 size-3 shrink-0 text-primary/65" />{rule}</p>)}</div>
        </div>
        <div className="rounded-xl border border-white/7 bg-black/15 p-3">
          <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Learned grammar</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{intelligence.styleDNA.map((item) => <span key={item} className="rounded-full border border-[#8da4ff]/14 bg-[#8da4ff]/7 px-2 py-1 text-[9px] text-[#bdc9ff]">{item}</span>)}</div>
          {intelligence.audioEvidence.length > 0 && <p className="mt-2 text-[9px] leading-4 text-muted-foreground">Audio handling: {intelligence.audioEvidence.join(" · ")}</p>}
        </div>
      </div>

      <p className="mt-3 flex gap-2 text-[9px] leading-4 text-muted-foreground"><ShieldCheck className="mt-0.5 size-3 shrink-0 text-primary/65" />{plan.costRule}{plan.fullPassRequiresApproval ? " A deep pass remains locked behind a separate approval." : ""}</p>
    </div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className="rounded-xl border border-white/7 bg-black/20 px-3 py-2.5"><p className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className={`mt-1 text-xs font-medium ${accent ? "text-primary" : "text-[#d6d5cf]"}`}>{value}</p></div>;
}

function CreativeDecisionsPanel({ decisions, onChoose }: { decisions: CreativeDecision[]; onChoose: (decision: CreativeDecision, option: string) => void }) {
  if (!decisions.length) return null;
  const openCount = decisions.filter((decision) => decision.status === "open").length;
  return (
    <div className="border-b border-[#d9a36c]/12 bg-[#d9a36c]/[0.035] px-5 py-5 sm:px-7">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel icon={<Volume2 className="size-4" />} title="Director asks before sound" note={openCount ? `${openCount} decision${openCount === 1 ? "" : "s"} open` : "sound direction resolved"} />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {decisions.map((decision) => (
          <div key={decision.id} className="rounded-2xl border border-white/8 bg-black/15 p-4">
            <div className="flex items-start justify-between gap-3"><p className="text-xs font-medium">{decision.question}</p>{decision.status === "resolved" && <Badge variant="outline" className="border-primary/20 bg-primary/8 text-[8px] text-primary">Resolved</Badge>}</div>
            <p className="mt-1.5 text-[9px] leading-4 text-muted-foreground">{decision.context}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {decision.options.map((option) => {
                const selected = decision.answer === option;
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={selected}
                    aria-pressed={selected}
                    onClick={() => onChoose(decision, option)}
                    className={`rounded-full border px-2.5 py-1.5 text-[9px] transition ${selected ? "border-primary/35 bg-primary/14 text-primary" : option === decision.recommended ? "border-primary/18 bg-primary/[0.06] text-primary/80 hover:bg-primary/10" : "border-white/9 bg-white/3 text-[#aaa9a1] hover:border-white/18"}`}
                  >
                    {selected && <Check className="mr-1 inline size-2.5" />}{option}{selected ? " · selected" : option === decision.recommended ? " · recommended" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DirectorReply({
  direction,
  mediaWorker,
  references,
  selectedShotIds,
  onSelectShot,
  productionLocked,
  onLock,
  onApprove,
  onAnalyzeReferences,
  onUpgradeConcept,
  onDecision,
  production,
  productionLoading,
  productionAction,
  productionElapsedSeconds,
  assemblyProgress,
  productionError,
  onBuildEvidence,
  onApproveProductionStage,
  onSkipProductionVoice,
  onSkipProductionScore,
  onGenerateProductionStage,
  onAssemble,
  onRunQc,
  onResetFailedArtifact,
  onRefreshProduction,
}: {
  direction: DirectionState;
  mediaWorker: MediaWorkerState;
  references: WorkingReference[];
  selectedShotIds: string[];
  onSelectShot: (id: string) => void;
  productionLocked: boolean;
  onLock: () => Promise<void>;
  onApprove: (section: ApprovalSection) => void;
  onAnalyzeReferences: () => void;
  onUpgradeConcept: () => void;
  onDecision: (decision: CreativeDecision, option: string) => void;
  production: ProductionRunPublic | null;
  productionLoading: boolean;
  productionAction: string | null;
  productionElapsedSeconds: number;
  assemblyProgress: string | null;
  productionError: string | null;
  onBuildEvidence: () => void;
  onApproveProductionStage: (stage: ProductionStage) => void;
  onSkipProductionVoice: () => void;
  onSkipProductionScore: () => void;
  onGenerateProductionStage: () => void;
  onAssemble: () => void;
  onRunQc: () => void;
  onResetFailedArtifact: (artifactId: string) => void;
  onRefreshProduction: () => void;
}) {
  const card = direction.card;
  const grammar = card.filmGrammar ?? fallbackGrammar();
  const shots = shotsFor(card);
  const locks = locksFor(card, references);
  const departments = departmentsFor(card);
  const referencePlan = referencePlanFor(card, references);
  const intelligence = intelligenceFor(card);
  const openDecisionCount = (card.creativeDecisions ?? []).filter((decision) => decision.status === "open").length;
  const approvalStage: ApprovalStage = productionLocked ? "complete" : card.approvalStage ?? "concept";
  const approved = new Set(card.approvedSections ?? []);
  const referenceAnalysisRequired = intelligence.status !== "analyzed" && references.some((reference) =>
    reference.mimeType.startsWith("video/") && ["style", "motion", "raw", "patch"].includes(reference.role),
  );
  const legacyConcept = card.analysisProvenance?.contractVersion !== DIRECTOR_CONTRACT_VERSION;
  const conceptV2Ready = card.analysisProvenance?.contractVersion === DIRECTOR_CONTRACT_VERSION && card.conceptQuality?.status === "passed" && Boolean(card.conceptStrategy);
  const stepIndex = approvalStage === "concept" ? 0 : approvalStage === "language" ? 1 : approvalStage === "shots" ? 2 : approvalStage === "sound" ? 3 : 4;
  const visibleRevisionPlan = approvalStage !== "concept" && card.revisionPlan?.target === "Concept strategy only" ? null : card.revisionPlan;
  return (
    <div className="flex gap-3">
      <HaykAvatar />
      <div className="hayk-arrive min-w-0 flex-1 overflow-hidden rounded-[26px] border border-white/9 bg-[#10110e] shadow-[0_30px_100px_rgba(0,0,0,0.25)]">
        <div className="border-b border-white/8 px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><Badge className="bg-primary/12 text-primary">{visibleRevisionPlan ? approvalStage === "concept" ? "CONCEPT REVISION" : "SURGICAL REVISION" : "DIRECTOR CHECKPOINT"}</Badge><span className="text-[10px] text-muted-foreground">{card.title}</span></div>
            <span className="text-[9px] uppercase tracking-[0.14em] text-primary/65">{approvalStage === "complete" ? "Direction locked" : `Step ${stepIndex + 1} of 5`}</span>
          </div>
          <ApprovalTrail active={approvalStage} approved={approved} />
        </div>

        {visibleRevisionPlan && <RevisionPanel plan={visibleRevisionPlan} onApplyRevision={() => { if (visibleRevisionPlan.target.includes("S0")) { const shotMatch = visibleRevisionPlan.target.match(/(S\d{2})/); if (shotMatch) { onRegenerateShot(shotMatch[1]); } } }} />}

        {approvalStage === "concept" && (
          <div className="relative overflow-hidden px-5 py-6 sm:px-7">
            <div className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-primary/[0.07] blur-3xl" />
            <div className="relative">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary/70">1 · The idea HAYK will protect</p>
              <h2 className="mt-3 text-2xl font-medium tracking-[-0.04em] sm:text-[34px]">{card.title}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#c6c5bd]">{card.creativePromise}</p>
              {card.analysisProvenance ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#9db8ff]/15 bg-[#9db8ff]/[0.045] px-3 py-2.5 text-[10px]">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-3.5 text-[#9db8ff]" />
                    <div>
                      <p className="font-medium uppercase tracking-[0.12em] text-[#9db8ff]">Analysis provenance</p>
                      <p className="mt-0.5 text-[#c6c5bd]">
                        {card.analysisProvenance.source === "ai"
                          ? `${card.analysisProvenance.model} via ${card.analysisProvenance.provider}`
                          : "Deterministic planning scaffold · AI not run"}
                      </p>
                    </div>
                  </div>
                  <span className="text-muted-foreground">
                    {card.analysisProvenance.referenceCount} refs · {card.analysisProvenance.imageReferenceCount} images · {card.analysisProvenance.storyboardFrameCount} video frames
                  </span>
                </div>
              ) : null}
              {card.conceptStrategy ? (
                <div className="mt-4 overflow-hidden rounded-2xl border border-white/8 bg-black/15">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-primary/75">Automated concept checks</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">Checks grounding, tension, memory, ownership and reference evidence. Passing does not replace founder creative approval.</p>
                    </div>
                    <Badge className={card.conceptQuality?.status === "passed" ? "bg-primary/12 text-primary" : "bg-[#d9a36c]/12 text-[#e1b47c]"}>
                      {card.conceptQuality?.status === "passed" ? "Checks passed · Human review" : `Revision required · ${card.conceptQuality?.issues.length ?? 0} issue${card.conceptQuality?.issues.length === 1 ? "" : "s"}`}
                    </Badge>
                  </div>
                  <div className="grid sm:grid-cols-2">
                    {[
                      ["Human insight", card.conceptStrategy.humanInsight],
                      ["Central tension", card.conceptStrategy.centralTension],
                      ["Brand-owned mechanism", card.conceptStrategy.creativeMechanism],
                      ["Memory device", card.conceptStrategy.memoryDevice],
                      ["Emotional arc", card.conceptStrategy.emotionalArc],
                      ["Audience psychology", card.conceptStrategy.audiencePsychology],
                      ["Why NUMU owns it", card.conceptStrategy.brandOwnership],
                      ["Reference evidence", card.conceptStrategy.referenceConnection],
                    ].map(([label, value], index) => (
                      <div key={label} className={`px-4 py-3 ${index % 2 === 0 ? "sm:border-r" : ""} ${index < 6 ? "border-b" : ""} border-white/8`}>
                        <p className="text-[8px] uppercase tracking-[0.13em] text-muted-foreground">{label}</p>
                        <p className="mt-1.5 text-[10px] leading-5 text-[#d1d0c9]">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-white/8 px-4 py-3">
                    <p className="text-[8px] uppercase tracking-[0.13em] text-muted-foreground">Distinctiveness proof</p>
                    <p className="mt-1.5 text-[10px] leading-5 text-[#d1d0c9]">{card.conceptStrategy.distinctivenessProof}</p>
                    {card.conceptQuality?.issues.length ? <p className="mt-2 text-[9px] leading-5 text-[#e1b47c]">Gate issues: {card.conceptQuality.issues.join(" · ")}</p> : null}
                  </div>
                </div>
              ) : null}
              {!conceptV2Ready && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#d9a36c]/20 bg-[#d9a36c]/[0.05] p-4">
                  <div className="max-w-2xl">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#e1b47c]">Concept approval blocked</p>
                    <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{legacyConcept ? "This treatment predates the stronger creative-intelligence contract. Upgrade it once; later identical submissions reopen it without another model charge." : "The concept is saved, but it has not passed every listed creative gate. Redesign only the concept; the saved reference intelligence will be reused."}</p>
                  </div>
                  <Button type="button" onClick={onUpgradeConcept} className="rounded-full bg-[#e1b47c] text-[#15110d] hover:bg-[#efc99c]"><Sparkles className="size-3.5" /> {legacyConcept ? "Upgrade concept" : "Redesign concept"}</Button>
                </div>
              )}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <IntentPill icon={<Target className="size-4" />} label="Business objective" value={card.objective ?? "Brand awareness and memorability"} />
                <IntentPill icon={<ChevronRight className="size-4" />} label="Audience action" value={card.audienceAction ?? "Attention first; CTA only when useful"} />
              </div>
              <CheckpointFooter label={conceptV2Ready ? "Approve distinctive concept" : "Creative gate required"} hint={conceptV2Ready ? "Approve the psychology and brand-owned idea only. Camera, shots and sound come next." : legacyConcept ? "Upgrade this legacy concept before approval; no production render can start." : "Resolve the listed creative gate issues before approval; no production render can start."} disabled={!conceptV2Ready} onApprove={() => onApprove("concept")} />
            </div>
          </div>
        )}

        {approvalStage === "language" && (
          <div>
            <div className="px-5 pt-6 sm:px-7"><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary/70">2 · Visual world</p><p className="mt-2 text-sm text-[#c6c5bd]">Confirm how the film should feel before HAYK choreographs a single shot.</p></div>
            <ReferenceIntelligencePanel plan={referencePlan} intelligence={intelligence} />
            <div className="px-5 py-5 sm:px-7">
              <SectionLabel icon={<Palette className="size-4" />} title="Film language" note="editable in chat" />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {Object.entries(grammar).map(([key, value]) => <div key={key} className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2"><p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{key}</p><p className="mt-1 text-[11px] leading-5 text-[#d5d4cd]">{value}</p></div>)}
              </div>
              <CheckpointFooter
                label={referenceAnalysisRequired ? "Analyze reference first" : "Approve visual world"}
                hint={referenceAnalysisRequired ? "Approval is blocked until HAYK proves it studied the sampled reference frames." : "Approval runs one bounded shot-planning call. No video, image or audio generation starts."}
                onApprove={referenceAnalysisRequired ? onAnalyzeReferences : () => onApprove("language")}
              />
            </div>
          </div>
        )}

        {approvalStage === "shots" && (
          <div className="px-5 py-6 sm:px-7">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary/70">3 · Shot sequence</p>
            <div className="mt-2"><SectionLabel icon={<Clapperboard className="size-4" />} title="Directed shot graph" note={`${shots.length} separately editable shots`} /></div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">{shots.map((shot) => <ShotCard key={shot.id} shot={shot} selected={selectedShotIds.includes(shot.id)} onSelect={() => onSelectShot(shot.id)} />)}</div>
            <CheckpointFooter label="Approve shot sequence" hint={selectedShotIds.length ? `${selectedShotIds.length} shot${selectedShotIds.length === 1 ? "" : "s"} selected. Your next chat revision will change only ${selectedShotIds.join(" + ")}.` : "Tap one or more shots to revise them together; every unselected shot stays locked."} onApprove={() => onApprove("shots")} />
          </div>
        )}

        {approvalStage === "sound" && (
          <div>
            <div className="px-5 pt-6 sm:px-7"><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary/70">4 · Sound and voice</p><p className="mt-2 text-sm text-[#c6c5bd]">Picture is protected. Decide what the audience should hear.</p></div>
            <CreativeDecisionsPanel decisions={card.creativeDecisions ?? []} onChoose={onDecision} />
            <div className="px-5 py-5 sm:px-7">
              <div className="grid gap-2 sm:grid-cols-2">{(card.soundDesign ?? []).slice(0, 4).map((item) => <div key={item} className="flex gap-2 rounded-xl border border-white/7 bg-white/[0.02] px-3 py-2.5 text-[10px] leading-5 text-[#bdbcb5]"><Volume2 className="mt-1 size-3 shrink-0 text-primary/55" />{item}</div>)}</div>
              <CheckpointFooter label="Approve sound direction" hint={openDecisionCount ? `Choose ${openDecisionCount} open option${openDecisionCount === 1 ? "" : "s"} above first.` : "Next is one compact final lock."} disabled={openDecisionCount > 0} onApprove={() => onApprove("sound")} />
            </div>
          </div>
        )}

        {approvalStage === "final" && (
          <div className="px-5 py-6 sm:px-7">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary/70">5 · Final lock</p>
            <h2 className="mt-3 text-2xl font-medium tracking-[-0.04em]">Ready to protect “{card.title}”</h2>
            <p className="mt-2 text-sm leading-6 text-[#c6c5bd]">The concept, visual world, shot sequence and sound direction are approved. Review only the locks that will survive every revision.</p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">{locks.map((lock) => <div key={`${lock.type}-${lock.name}`} className="flex items-center gap-2.5 rounded-xl border border-white/7 bg-white/[0.02] px-3 py-2.5"><span className={`grid size-6 place-items-center rounded-lg ${lock.status === "locked" ? "bg-primary/10 text-primary" : "bg-[#c88d51]/10 text-[#d9a36c]"}`}>{lock.status === "locked" ? <Lock className="size-3" /> : <Plus className="size-3" />}</span><div><p className="text-[11px] text-[#d1d0c9]">{lock.name}</p><p className="mt-0.5 text-[9px] capitalize text-muted-foreground">{lock.status}</p></div></div>)}</div>
            <div className="mt-5 rounded-2xl border border-white/8 bg-black/15 p-4"><SectionLabel icon={<Layers className="size-4" />} title="Studio handoff" note={`${departments.length} departments`} /><p className="mt-2 text-[10px] leading-5 text-muted-foreground">After locking, HAYK prepares the production route and exact price. No generation happens here.</p></div>
            <div className="mt-5 flex justify-end"><TreatmentLockDialog card={card} onLock={onLock} /></div>
          </div>
        )}

        {approvalStage === "complete" && (
          <ProductionStudio
            card={card}
            mediaWorker={mediaWorker}
            production={production}
            loading={productionLoading}
            action={productionAction}
            elapsedSeconds={productionElapsedSeconds}
            assemblyProgress={assemblyProgress}
            error={productionError}
            onBuildEvidence={onBuildEvidence}
            onApproveStage={onApproveProductionStage}
            onSkipVoice={onSkipProductionVoice}
            onSkipScore={onSkipProductionScore}
            onGenerateStage={onGenerateProductionStage}
            onAssemble={onAssemble}
            onRunQc={onRunQc}
            onResetFailedArtifact={onResetFailedArtifact}
            onRefresh={onRefreshProduction}
          />
        )}
      </div>
    </div>
  );
}

function ProductionStudio({
  card,
  mediaWorker,
  production,
  loading,
  action,
  elapsedSeconds,
  assemblyProgress,
  error,
  onBuildEvidence,
  onApproveStage,
  onSkipVoice,
  onSkipScore,
  onGenerateStage,
  onAssemble,
  onRunQc,
  onResetFailedArtifact,
  onRefresh,
}: {
  card: DirectorCard;
  mediaWorker: MediaWorkerState;
  production: ProductionRunPublic | null;
  loading: boolean;
  action: string | null;
  elapsedSeconds: number;
  assemblyProgress: string | null;
  error: string | null;
  onBuildEvidence: () => void;
  onApproveStage: (stage: ProductionStage) => void;
  onSkipVoice: () => void;
  onSkipScore: () => void;
  onGenerateStage: () => void;
  onAssemble: () => void;
  onRunQc: () => void;
  onResetFailedArtifact: (artifactId: string) => void;
  onRefresh: () => void;
}) {
  if (loading && !production) {
    return <div className="border-t border-white/8 px-5 py-7 sm:px-7"><div className="flex items-center gap-3 text-sm"><LoaderCircle className="size-5 animate-spin text-primary" />Opening the protected production room…</div></div>;
  }
  if (!production) {
    return <div className="border-t border-white/8 px-5 py-7 sm:px-7"><p className="text-sm font-medium">The production room is unavailable.</p><p className="mt-2 text-[10px] text-muted-foreground">{error ?? "Nothing was generated or spent."}</p><Button variant="outline" onClick={onRefresh} className="mt-4 rounded-full border-white/12"><RefreshCw className="size-3.5" /> Reopen production room</Button></div>;
  }

  const stage = production.currentStage;
  const stageArtifacts = production.artifacts.filter((artifact) => artifact.stage === stage);
  const requiredArtifacts = stageArtifacts.filter((artifact) => artifact.kind !== "source_asset");
  const stageReady = Boolean(requiredArtifacts.length) && requiredArtifacts.every((artifact) => artifact.status === "completed");
  const failedArtifacts = stageArtifacts.filter((artifact) => artifact.status === "failed");
  const failedArtifactReusesApproval = failedArtifacts[0]?.metadata.interruptedRequest === true
    && failedArtifacts[0]?.metadata.retryUsesExistingApproval === true;
  const master = production.artifacts.find((artifact) => ["master_cut", "review_cut"].includes(artifact.kind) && artifact.mediaUrl);
  const report = production.artifacts.find((artifact) => artifact.kind === "qc_report" && artifact.status === "completed");
  const estimateSeconds = stage === "evidence" ? 70 : stage === "identity" ? 100 * Math.max(1, requiredArtifacts.length) : stage === "storyboard" ? 85 * Math.max(1, requiredArtifacts.length) : stage === "motion" ? 300 : stage === "voice" ? 120 : stage === "score" ? 45 : stage === "stems" ? 90 : stage === "conform" ? 120 : 75;
  const remaining = Math.max(0, estimateSeconds - elapsedSeconds);

  return (
    <div>
      <div className="border-b border-white/8 px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck className="size-5" /></span>
            <div><h2 className="text-lg font-medium">Direction locked. Production is visible.</h2><p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">Every AI input, frame, source shot, cost and QC result is now a persistent artifact. HAYK cannot skip a gate or hide a one-pass render behind studio language.</p></div>
          </div>
          <div className="rounded-xl border border-primary/15 bg-primary/[0.05] px-3 py-2 text-right"><p className="text-[8px] uppercase tracking-[0.14em] text-muted-foreground">Verified spend</p><p className="mt-1 font-mono text-sm text-primary">${production.actualCostUsd.toFixed(2)}</p></div>
        </div>
        <ProductionTrail current={stage} artifacts={production.artifacts} />
        <StudioRouteMap />
      </div>

      {action && <ProductionWorking action={assemblyProgress ?? action} elapsedSeconds={elapsedSeconds} remainingSeconds={remaining} />}

      <div className="px-5 py-6 sm:px-7">
        {stage === "evidence" && <div><EvidenceGate card={card} artifacts={stageArtifacts} ready={stageReady} busy={Boolean(action)} onBuild={onBuildEvidence} onApprove={() => onApproveStage("evidence")} /></div>}

        {(stage === "identity" || stage === "storyboard") && (
          <div>
          <VisualGenerationGate
            stage={stage}
            artifacts={stageArtifacts}
            quote={production.quote}
            authorizedMaxCostUsd={production.approvedCostUsd}
            ready={stageReady}
            busy={Boolean(action)}
            onGenerate={onGenerateStage}
            onApprove={() => onApproveStage(stage)}
          />
          </div>
        )}

        {stage === "motion" && (
          <div><MotionGate artifacts={stageArtifacts} tasks={production.tasks} quote={production.quote} authorizedMaxCostUsd={production.approvedCostUsd} ready={stageReady} busy={Boolean(action)} onGenerate={onGenerateStage} onApprove={() => onApproveStage("motion")} /></div>
        )}

        {stage === "voice" && <div><VoiceGate artifacts={stageArtifacts} busy={Boolean(action)} onSkip={onSkipVoice} /></div>}

        {stage === "score" && <div><ScoreGate artifacts={stageArtifacts} quote={production.quote} authorizedMaxCostUsd={production.approvedCostUsd} ready={stageReady} busy={Boolean(action)} onGenerate={onGenerateStage} onSkip={onSkipScore} onApprove={() => onApproveStage("score")} /></div>}

        {stage === "stems" && <div><StemsGate artifacts={stageArtifacts} mediaWorker={mediaWorker} /></div>}

        {stage === "conform" && <div><AssemblyGate artifacts={production.artifacts} master={master} ready={stageReady} busy={Boolean(action)} deliverySeconds={card.deliverySeconds} onAssemble={onAssemble} onApprove={() => onApproveStage("conform")} /></div>}

        {stage === "qc" && <div><QcGate report={report} busy={Boolean(action)} onRun={onRunQc} master={master} /></div>}

        {stage === "master" && <div><MasterGate production={production} master={master} report={report} /></div>}

        {failedArtifacts.length > 0 && (
          <div className="mt-5 rounded-2xl border border-destructive/25 bg-destructive/[0.055] p-4">
            <Badge variant="outline" className="border-destructive/25 text-destructive">STAGE STOPPED · NO AUTOMATIC RETRY</Badge>
            <p className="mt-3 text-sm font-medium">{failedArtifacts.map((artifact) => artifact.label).join(", ")}</p>
            <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{failedArtifacts[0]?.error ?? "A provider stopped this artifact."} The completed artifacts remain protected.</p>
            {["identity", "storyboard", "motion", "voice", "score", "stems", "conform"].includes(stage) && <Button disabled={Boolean(action)} variant="outline" onClick={() => onResetFailedArtifact(failedArtifacts[0].id)} className="mt-4 rounded-full border-destructive/25"><RefreshCw className="size-3.5" /> {failedArtifactReusesApproval ? "Prepare one manual retry" : "Prepare one manual retry quote"}</Button>}
          </div>
        )}

        {error && <div className="mt-5 rounded-2xl border border-destructive/25 bg-destructive/[0.055] p-4 text-[10px] leading-5 text-destructive">{error}</div>}
      </div>
    </div>
  );
}

function StudioRouteMap() {
  const live = STUDIO_CAPABILITIES.filter((item) => item.status === "live").length;
  return (
    <details className="mt-4 rounded-2xl border border-white/8 bg-black/15 open:border-primary/15">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-[9px] text-muted-foreground">
        <span className="flex items-center gap-2"><Layers className="size-3.5 text-primary/65" /> Production route map · {live}/{STUDIO_CAPABILITIES.length} routes connected</span>
        <span className="text-primary/70">inspect models + limits</span>
      </summary>
      <div className="grid gap-2 border-t border-white/7 p-3 sm:grid-cols-2">
        {STUDIO_CAPABILITIES.map((capability) => (
          <div key={capability.id} className="rounded-xl border border-white/7 bg-white/[0.02] p-3">
            <div className="flex items-start justify-between gap-2"><p className="text-[10px] font-medium text-[#d4d3cc]">{capability.department}</p><span className={`rounded-full border px-2 py-0.5 text-[7px] ${capability.status === "live" ? "border-primary/20 text-primary" : capability.status === "connector_required" ? "border-[#9db2ff]/20 text-[#9db2ff]" : "border-white/10 text-muted-foreground"}`}>{capability.status.replaceAll("_", " ")}</span></div>
            <p className="mt-1 text-[9px] leading-4 text-muted-foreground">{capability.route}</p>
            <p className="mt-2 text-[8px] leading-4 text-muted-foreground/75">{capability.reason}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

function ProductionTrail({ current, artifacts }: { current: ProductionStage; artifacts: ProductionArtifactPublic[] }) {
  const stages: Array<{ id: ProductionStage; label: string }> = [
    { id: "evidence", label: "Evidence" },
    { id: "identity", label: "Identity" },
    { id: "storyboard", label: "Frames" },
    { id: "motion", label: "Motion" },
    { id: "voice", label: "Voice" },
    { id: "score", label: "Score" },
    { id: "stems", label: "Stems" },
    { id: "conform", label: "Finish" },
    { id: "qc", label: "QC" },
    { id: "master", label: "Master" },
  ];
  const currentIndex = stages.findIndex((item) => item.id === current);
  return <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">{stages.map((item, index) => { const stageArtifacts = artifacts.filter((artifact) => artifact.stage === item.id && artifact.kind !== "source_asset"); const complete = index < currentIndex || (item.id === "master" && current === "master"); const working = item.id === current; const count = stageArtifacts.filter((artifact) => artifact.status === "completed").length; return <div key={item.id} className={`flex min-w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[8px] ${complete ? "border-primary/20 bg-primary/8 text-primary" : working ? "border-white/18 bg-white/6 text-foreground" : "border-white/7 text-muted-foreground/50"}`}>{complete ? <Check className="size-2.5" /> : <span className={`size-1.5 rounded-full ${working ? "bg-primary" : "bg-white/15"}`} />}{item.label}{stageArtifacts.length > 1 ? <span className="text-[7px] opacity-60">{count}/{stageArtifacts.length}</span> : null}</div>; })}</div>;
}

function ProductionWorking({ action, elapsedSeconds, remainingSeconds }: { action: string; elapsedSeconds: number; remainingSeconds: number }) {
  return <div className="border-b border-primary/15 bg-primary/[0.045] px-5 py-5 sm:px-7" role="status" aria-live="polite"><div className="flex items-start gap-3"><LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-primary" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{action}</p><Badge variant="outline" className="border-primary/20 text-primary">artifacts stream here</Badge></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/6"><div className="h-full w-2/3 animate-pulse rounded-full bg-[linear-gradient(90deg,rgba(217,255,87,0.2),rgba(217,255,87,0.95),rgba(217,255,87,0.2))]" /></div><div className="mt-2 flex flex-wrap justify-between gap-2 text-[9px] text-muted-foreground"><span>{clockLabel(elapsedSeconds)} elapsed</span><span>{remainingSeconds ? `Planning estimate ~${clockLabel(remainingSeconds)} remaining` : "Provider is finishing; no false countdown"}</span></div></div></div></div>;
}

function EvidenceGate({ card, artifacts, ready, busy, onBuild, onApprove }: { card: DirectorCard; artifacts: ProductionArtifactPublic[]; ready: boolean; busy: boolean; onBuild: () => void; onApprove: () => void }) {
  const sources = artifacts.filter((artifact) => artifact.kind === "source_asset");
  const frames = artifacts.filter((artifact) => artifact.kind === "reference_frame");
  const clips = artifacts.filter((artifact) => artifact.kind === "reference_clip");
  const dossier = artifacts.find((artifact) => artifact.kind === "reference_dossier");
  const dossierMetadata = guardEvidenceDossier(card, dossier?.metadata ?? {});
  const method = typeof dossierMetadata.analysisMethod === "string" ? dossierMetadata.analysisMethod : null;
  const audio = dossierMetadata.audio && typeof dossierMetadata.audio === "object" ? dossierMetadata.audio as Record<string, unknown> : null;
  const findings = Array.isArray(dossierMetadata.visualFindings) ? dossierMetadata.visualFindings as Array<Record<string, unknown>> : [];
  const translations = Array.isArray(dossierMetadata.productionTranslations) ? dossierMetadata.productionTranslations.filter((item): item is string => typeof item === "string") : [];
  return <div><GateHeading number="1" title="AI evidence room" subtitle="Inspect what the multimodal analyst actually saw before it influences a frame." badge="Gemini multimodal" />
    <p className="mt-4 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Protected source files</p><ArtifactGrid artifacts={sources} />
    {frames.length > 0 && <><p className="mt-5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Persisted timeline samples</p><ArtifactGrid artifacts={frames} /></>}
    {clips.length > 0 && <><p className="mt-5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Bounded audiovisual window actually sent to AI</p><ArtifactGrid artifacts={clips} /></>}
    {dossier?.status === "completed" ? <div className="mt-5 rounded-2xl border border-[#8da4ff]/18 bg-[#8da4ff]/[0.045] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] uppercase tracking-[0.14em] text-[#b8c5ff]">Evidence dossier</p><p className="mt-1 text-sm font-medium">{method === "full_multimodal_video" ? "Explicit full-source video + audio analyzed" : method === "bounded_av_window" ? "Bounded video + actual audio analyzed" : method === "sampled_storyboard" ? "Timeline samples analyzed" : "Image evidence analyzed"}</p></div><div className="text-right text-[9px] text-muted-foreground"><p>{String(dossier.metadata.framesAnalyzed ?? frames.length)} frames</p><p>{String(dossier.metadata.sourceSecondsAnalyzed ?? 0)}s audiovisual window</p><p className={audio?.actuallyAnalyzed ? "text-primary" : "text-[#d9a36c]"}>{audio?.actuallyAnalyzed ? "Audio truly analyzed" : "Audio not analyzed"}</p></div></div>{findings.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{findings.slice(0, 6).map((finding, index) => <div key={index} className="rounded-xl border border-white/7 bg-black/15 p-3"><p className="text-[10px] leading-5 text-[#d0cfd0]">{String(finding.observation ?? "Observed visual grammar")}</p><p className="mt-1 font-mono text-[8px] text-[#9db2ff]">evidence @ {Array.isArray(finding.evidenceSeconds) ? finding.evidenceSeconds.join("s, ") : "source"}s</p><p className="mt-1 text-[9px] leading-4 text-muted-foreground">{String(finding.productionUse ?? "Directing evidence")}</p></div>)}</div>}{translations.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{translations.slice(0, 8).map((item) => <span key={item} className="rounded-full border border-[#8da4ff]/15 bg-[#8da4ff]/7 px-2 py-1 text-[8px] text-[#bdc9ff]">{item}</span>)}</div>}</div> : <div className="mt-5 rounded-2xl border border-dashed border-white/12 bg-white/[0.02] p-5"><p className="text-sm font-medium">No production dossier exists yet.</p><p className="mt-1 text-[10px] leading-5 text-muted-foreground">For an inspiration reference, HAYK persists global frames across the full timeline and sends only a bounded audiovisual window to Gemini. This makes one low-cost Gemini 2.5 Pro analysis call; its actual token cost appears on the dossier afterward. Full-footage analysis is reserved for an explicit source edit or close reproduction.</p><Button disabled={busy} onClick={onBuild} className="mt-4 rounded-full bg-primary text-primary-foreground"><Film className="size-3.5" /> Build visible AI evidence</Button></div>}
    {ready && <StageApproval label="Approve evidence map" hint="This freezes only the proven observations and forbidden transfers." disabled={busy} onApprove={onApprove} />}
  </div>;
}

function VisualGenerationGate({ stage, artifacts, quote, authorizedMaxCostUsd, ready, busy, onGenerate, onApprove }: { stage: "identity" | "storyboard"; artifacts: ProductionArtifactPublic[]; quote: ProductionRunPublic["quote"]; authorizedMaxCostUsd: number | null; ready: boolean; busy: boolean; onGenerate: () => void; onApprove: () => void }) {
  const label = stage === "identity" ? "Canonical identity plates" : "Shot first + landing frames";
  return <div><GateHeading number={stage === "identity" ? "2" : "3"} title={label} subtitle={stage === "identity" ? "Exact product and character authorities are normalized before any shot is animated." : "Every shot gets an inspectable beginning and end. Motion cannot start until these frames are approved."} badge={quote?.modelName ?? artifacts.find((artifact) => artifact.model)?.model ?? "reference-aware image model"} /><ArtifactGrid artifacts={artifacts} />{!ready && quote && <PaidStageApproval quote={quote} authorizedMaxCostUsd={authorizedMaxCostUsd} busy={busy} verb={stage === "identity" ? "Generate identity plates" : "Generate all shot frames"} onApprove={onGenerate} />}{!ready && !quote && !busy && <p className="mt-5 text-[10px] text-muted-foreground">The live route is being verified. Refresh if no quote appears.</p>}{ready && <StageApproval label={stage === "identity" ? "Approve identities" : "Approve shot frames"} hint={stage === "identity" ? "Inspect exact bottle geometry, wardrobe coverage and falcon identity before storyboards." : "Inspect product shape, hands, wardrobe, composition and the start-to-end action handoff for every shot."} disabled={busy} onApprove={onApprove} />}</div>;
}

function MotionGate({ artifacts, tasks, quote, authorizedMaxCostUsd, ready, busy, onGenerate, onApprove }: { artifacts: ProductionArtifactPublic[]; tasks: ProductionRunPublic["tasks"]; quote: ProductionRunPublic["quote"]; authorizedMaxCostUsd: number | null; ready: boolean; busy: boolean; onGenerate: () => void; onApprove: () => void }) {
  const sourceEdit = artifacts.some((artifact) => {
    const contract = artifact.metadata.routeContract;
    return contract && typeof contract === "object" && (contract as Record<string, unknown>).mode === "source_edit";
  });
  return <div><GateHeading number="4" title="Independent source shots" subtitle={sourceEdit ? "HAYK detected source footage. Performance, timing and original audio stay protected while only approved visual layers are edited." : "Seedance 2.5 receives each approved first and landing frame. A bad shot can be replaced without rerendering the film."} badge={sourceEdit ? "Gemini Omni · protected source edit" : "Seedance 2.5 · 4s sources"} /><ArtifactGrid artifacts={artifacts} />{sourceEdit && !ready && <div className="mt-5 rounded-2xl border border-[#9db2ff]/20 bg-[#9db2ff]/[0.045] p-4"><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#9db2ff]">Verified source-preservation route</p><p className="mt-2 text-[10px] leading-5 text-muted-foreground">HAYK transfers the protected source privately to the connected Google worker, Gemini Omni edits only the approved visual layers, and the original audio remains separate for deterministic conform. Every edit has its own visible task and hard cost ceiling.</p></div>}{tasks.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{tasks.map((task) => <div key={task.id} className="rounded-xl border border-white/8 bg-black/15 px-3 py-2 text-[9px]"><div className="flex justify-between gap-2"><span className="text-[#d4d3cc]">{artifacts.find((artifact) => artifact.id === task.artifactId)?.label ?? "Source shot"}</span><span className={task.status === "completed" ? "text-primary" : task.status === "failed" ? "text-destructive" : "text-[#9db2ff]"}>{task.status}</span></div><p className="mt-1 text-muted-foreground">ceiling ${task.maxCostUsd.toFixed(2)} · actual {task.actualCostUsd === null ? "pending" : `$${task.actualCostUsd.toFixed(2)}`}</p></div>)}</div>}{!ready && quote && <PaidStageApproval quote={quote} authorizedMaxCostUsd={authorizedMaxCostUsd} busy={busy} verb={sourceEdit ? "Edit protected source shots" : "Produce every source shot"} onApprove={onGenerate} />}{ready && <StageApproval label="Approve source shots" hint="Play every clip. Approving freezes the motion and sound source before the edit is assembled." disabled={busy} onApprove={onApprove} />}</div>;
}

function VoiceGate({ artifacts, busy, onSkip }: { artifacts: ProductionArtifactPublic[]; busy: boolean; onSkip: () => void }) {
  const script = artifacts.find((artifact) => artifact.kind === "voice_audition")?.metadata.identicalScript;
  return <div><GateHeading number="5" title="Voice casting, consent and lip-sync" subtitle="No voice can be cloned, converted or attached to a face until its owner grants explicit scope and a Tunisian reviewer scores blind auditions made from one identical script." badge="consent hard gate" />{typeof script === "string" && <div className="mt-4 rounded-2xl border border-[#9db2ff]/18 bg-[#9db2ff]/[0.04] p-4"><p className="text-[9px] uppercase tracking-[0.14em] text-[#9db2ff]">Identical Derja audition script</p><p lang="ar-TN" dir="rtl" className="mt-2 text-sm leading-7 text-[#dddcd4]">{script}</p></div>}<ArtifactGrid artifacts={artifacts} /><div className="mt-5 rounded-2xl border border-[#d9a36c]/20 bg-[#d9a36c]/[0.04] p-4 text-[10px] leading-5 text-muted-foreground"><p className="font-medium text-[#d9a36c]">Production remains blocked</p><p className="mt-1">Required controls: named voice owner, revocable audition/clone/conversion/lip-sync consent, sample transcript, three playable blind candidates, native naturalness/pronunciation/emotion scores and one approved winner. Uploading audio alone never implies consent.</p></div><div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-black/15 p-4"><div><p className="text-sm font-medium">This film has no dialogue</p><p className="mt-1 text-[10px] leading-5 text-muted-foreground">Protect an explicit no-voice decision and continue to score. Music, ambience, Foley and effects remain mandatory.</p></div><Button disabled={busy} onClick={onSkip} variant="outline" className="shrink-0 rounded-full border-white/12">Protect no-voice decision</Button></div></div>;
}

function ScoreGate({ artifacts, quote, authorizedMaxCostUsd, ready, busy, onGenerate, onSkip, onApprove }: { artifacts: ProductionArtifactPublic[]; quote: ProductionRunPublic["quote"]; authorizedMaxCostUsd: number | null; ready: boolean; busy: boolean; onGenerate: () => void; onSkip: () => void; onApprove: () => void }) {
  const prompt = artifacts.find((artifact) => artifact.kind === "score_master")?.prompt;
  return <div><GateHeading number="6" title="Original score approval" subtitle="Lyria creates an original 48kHz score as its own paid job. Picture and dialogue stay untouched, music is playable before approval, and provider failure never triggers an automatic retry." badge="Lyria 3 Clip · $0.04" />{prompt && <div className="mt-4 rounded-2xl border border-white/8 bg-black/15 p-4"><p className="text-[8px] uppercase tracking-[0.13em] text-muted-foreground">Score brief sent to Lyria</p><p className="mt-2 text-[10px] leading-5 text-[#d1d0c9]">{prompt}</p></div>}<ArtifactGrid artifacts={artifacts} />{!ready && quote && <PaidStageApproval quote={quote} authorizedMaxCostUsd={authorizedMaxCostUsd} busy={busy} verb="Generate original score" onApprove={onGenerate} />}{!ready && <div className="mt-4 flex flex-col justify-between gap-3 rounded-2xl border border-white/8 bg-black/15 p-4 sm:flex-row sm:items-center"><div><p className="text-sm font-medium">Use the approved source-shot audio only</p><p className="mt-1 text-[10px] leading-5 text-muted-foreground">This adds no score charge and moves directly to the test-video assembly. Seedance ambience, Foley and effects remain synchronized to picture.</p></div><Button disabled={busy} onClick={onSkip} variant="outline" className="shrink-0 rounded-full border-white/12">Continue without separate score</Button></div>}{ready && <StageApproval label="Approve original score" hint="Play the WAV with picture in mind. It will be mixed under the synchronized source-shot audio in the review cut." disabled={busy} onApprove={onApprove} />}</div>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function WorkerCapabilityPanel(_props: { worker: MediaWorkerState; context: "stems" | "finish" }) {
  return null;
}

function StemsGate({ artifacts, mediaWorker }: { artifacts: ProductionArtifactPublic[]; mediaWorker: MediaWorkerState }) {
  return <div><GateHeading number="7" title="Five isolated soundtrack stems" subtitle="Dialogue, music, ambience, Foley and effects are separate 48kHz WAV artifacts. Each can be muted, replaced, remixed and approved without rerendering picture." badge="5 × 48kHz WAV" /><ArtifactGrid artifacts={artifacts} /><WorkerCapabilityPanel worker={mediaWorker} context="stems" /></div>;
}

function AssemblyGate({ artifacts, master, ready, busy, deliverySeconds, onAssemble, onApprove }: { artifacts: ProductionArtifactPublic[]; master: ProductionArtifactPublic | undefined; ready: boolean; busy: boolean; deliverySeconds: number; onAssemble: () => void; onApprove: () => void }) {
  const shots = artifacts.filter((artifact) => artifact.kind === "shot_video");
  const assemblyDuration = shots.length * 4;
  return <div><GateHeading number="5" title="Final test-video assembly" subtitle={`All approved source shots and their synchronized audio are preloaded, then trimmed to the locked ${deliverySeconds}s edit decision list in the browser. The result is a complete downloadable test video; a broadcast/cinema ProRes master still requires the optional professional media worker.`} badge="$0 deterministic assembly" /><ArtifactGrid artifacts={master ? [master] : shots} />{!ready && <Button disabled={busy} onClick={onAssemble} className="mt-5 rounded-full bg-primary text-primary-foreground"><Scissors className="size-3.5" /> Assemble {assemblyDuration}s final test video</Button>}{ready && <div className="mt-4 flex flex-wrap items-center gap-3">{master && <Button asChild className="rounded-full bg-primary text-primary-foreground"><a href={`/api/production/artifacts/${master.id}/media`} target="_blank" rel="noopener noreferrer"><Download className="size-3.5" /> Download test video</a></Button>}<StageApproval label="Approve final test video" hint="Watch the complete video. Approval sends this exact file—not a prompt—to continuity QC." disabled={busy} onApprove={onApprove} /></div>}</div>;
}

function QcGate({ report, busy, onRun, master }: { report: ProductionArtifactPublic | undefined; busy: boolean; onRun: () => void; master?: ProductionArtifactPublic }) {
  const gates = Array.isArray(report?.metadata.gates) ? report.metadata.gates as Array<Record<string, unknown>> : [];
  const blocked = report?.approvalStatus === "blocked";
  return <div><GateHeading number="6" title="Continuity hard gate" subtitle="Gemini watches the assembled final test video against the protected product and character authorities. Failed gates identify only the shots that need revision. This is one low-cost multimodal analysis call; actual token cost is recorded afterward." badge="multimodal final-video QC" />{master?.mediaUrl && <div className="mt-5"><video src={master.mediaUrl} controls playsInline preload="metadata" className="aspect-[9/16] max-h-[600px] w-full max-w-sm rounded-2xl border border-white/10 bg-black object-contain" />{master.mediaUrl && <Button asChild className="mt-3 rounded-full bg-primary text-primary-foreground"><a href={`/api/production/artifacts/${master.id}/media`} target="_blank" rel="noreferrer"><Download className="size-3.5" /> Download video</a></Button>}</div>}{report?.status === "completed" ? <div className={`mt-5 rounded-2xl border p-4 ${blocked ? "border-destructive/25 bg-destructive/[0.04]" : "border-primary/20 bg-primary/[0.04]"}`}><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">{String(report.metadata.summary ?? "QC completed")}</p><Badge variant="outline" className={blocked ? "border-destructive/25 text-destructive" : "border-primary/25 text-primary"}>{String(report.metadata.verdict ?? "review")}</Badge></div><div className="mt-4 space-y-2">{gates.map((gate, index) => <div key={index} className="rounded-xl border border-white/7 bg-black/15 p-3"><div className="flex justify-between gap-2 text-[10px]"><span>{String(gate.name ?? "QC gate")}</span><span className={gate.result === "fail" ? "text-destructive" : gate.result === "pass" ? "text-primary" : "text-[#d9a36c]"}>{String(gate.result ?? "review")}</span></div><p className="mt-1 text-[9px] leading-4 text-muted-foreground">{String(gate.note ?? "")}</p></div>)}</div>{blocked && <p className="mt-4 text-[10px] text-destructive">Blocking shots: {Array.isArray(report.metadata.blockingShotIds) ? report.metadata.blockingShotIds.join(" + ") : "see report"}. Select only those shots in chat for a surgical revision.</p>}</div> : <Button disabled={busy} onClick={onRun} className="mt-5 rounded-full bg-primary text-primary-foreground"><ShieldCheck className="size-3.5" /> Run continuity QC on final test video</Button>}</div>;
}

function MasterGate({ production, master, report }: { production: ProductionRunPublic; master: ProductionArtifactPublic | undefined; report: ProductionArtifactPublic | undefined }) {
  return <div><GateHeading number="7" title="QC-approved final test video" subtitle="This is the exact assembled file that passed the protected identity, physics, timing and audio review." badge={`actual spend $${production.actualCostUsd.toFixed(2)}`} />{master?.mediaUrl && <video src={master.mediaUrl} controls playsInline preload="metadata" className="mt-5 aspect-[9/16] max-h-[720px] w-full rounded-2xl border border-primary/18 bg-black object-contain" />}<div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-[10px] leading-5 text-muted-foreground">QC: {String(report?.metadata.summary ?? "Passed all required gates")}. All production artifacts remain attached to this project for targeted revisions.</p>{master?.mediaUrl && <Button asChild className="rounded-full bg-primary text-primary-foreground"><a href={master.mediaUrl} download><Download className="size-3.5" /> Download final video</a></Button>}</div></div>;
}

function GateHeading({ number, title, subtitle, badge }: { number: string; title: string; subtitle: string; badge: string }) {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary/70">{number} · production gate</p><h3 className="mt-2 text-xl font-medium tracking-[-0.03em]">{title}</h3><p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted-foreground">{subtitle}</p></div><Badge variant="outline" className="border-white/10 bg-white/[0.025] text-[9px] text-muted-foreground">{badge}</Badge></div>;
}

function ArtifactGrid({ artifacts }: { artifacts: ProductionArtifactPublic[] }) {
  if (!artifacts.length) return <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] p-5 text-[10px] text-muted-foreground">Artifacts will appear here one by one.</div>;
  return <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{artifacts.map((artifact) => {
    const audio = artifact.mediaUrl && artifact.mimeType?.startsWith("audio/");
    const video = artifact.mediaUrl && artifact.mimeType?.startsWith("video/");
    const image = artifact.mediaUrl && artifact.mimeType?.startsWith("image/");
    const audioKind = artifact.kind.includes("voice") || artifact.kind.includes("score") || artifact.kind.includes("stem") || artifact.kind.includes("dialogue");
    return <div key={artifact.id} className={`overflow-hidden rounded-2xl border ${artifact.status === "failed" ? "border-destructive/25" : artifact.status === "completed" ? "border-white/10" : "border-dashed border-white/10"} bg-white/[0.025]`}><div className="relative aspect-[9/16] bg-black/35">{image ? <Image src={artifact.mediaUrl!} alt={artifact.label} fill unoptimized sizes="(max-width: 640px) 100vw, 33vw" className="object-contain" /> : video ? <video src={artifact.mediaUrl!} controls playsInline preload="metadata" className="size-full object-contain" /> : audio ? <div className="flex size-full items-center px-4"><audio src={artifact.mediaUrl!} controls preload="metadata" className="w-full" /></div> : <div className="grid size-full place-items-center text-muted-foreground">{artifact.status === "working" ? <LoaderCircle className="size-7 animate-spin text-primary" /> : artifact.kind.includes("video") || artifact.kind.includes("clip") || artifact.kind === "lip_sync" ? <Video className="size-7 opacity-35" /> : audioKind ? <Volume2 className="size-7 opacity-35" /> : <ImageIcon className="size-7 opacity-35" />}</div>}<span className={`absolute right-2 top-2 rounded-full border px-2 py-1 text-[7px] uppercase tracking-[0.1em] backdrop-blur ${artifact.status === "completed" ? "border-primary/25 bg-black/65 text-primary" : artifact.status === "failed" ? "border-destructive/25 bg-black/65 text-destructive" : "border-white/10 bg-black/65 text-muted-foreground"}`}>{artifact.status}</span></div><div className="p-3"><div className="flex items-start justify-between gap-2"><p className="text-[10px] font-medium text-[#d4d3cc]">{artifact.label}</p>{artifact.shotId && !["DOSSIER", "MASTER", "QC"].includes(artifact.shotId) && <span className="font-mono text-[8px] text-primary/70">{artifact.shotId}</span>}</div>{artifact.model && <p className="mt-1 truncate text-[8px] text-[#9db2ff]">{artifact.model}</p>}<p className="mt-1 text-[8px] leading-4 text-muted-foreground">{typeof artifact.metadata.lineage === "string" ? artifact.metadata.lineage : "protected project artifact"}</p>{artifact.actualCostUsd !== null && <p className="mt-1 font-mono text-[8px] text-primary/65">actual ${artifact.actualCostUsd.toFixed(3)}</p>}</div></div>;
  })}</div>;
}

function PaidStageApproval({ quote, authorizedMaxCostUsd, busy, verb, onApprove }: { quote: NonNullable<ProductionRunPublic["quote"]>; authorizedMaxCostUsd: number | null; busy: boolean; verb: string; onApprove: () => void }) {
  const continuing = authorizedMaxCostUsd !== null;
  return <div className="mt-5 rounded-2xl border border-primary/18 bg-primary/[0.045] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] uppercase tracking-[0.14em] text-primary/70">{continuing ? "Approved stage · live route reverified" : "Live capability + price verified"}</p><p className="mt-1 text-sm font-medium">{quote.routeName}</p><p className="mt-1 text-[10px] text-muted-foreground">{quote.itemCount} remaining artifact{quote.itemCount === 1 ? "" : "s"} · {quote.modelName}{quote.provider ? ` · ${quote.provider}` : ""}</p></div><div className="text-right"><p className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">{continuing ? "Original approved ceiling" : "Hard ceiling"}</p><p className="mt-1 text-xl font-medium text-primary">${(authorizedMaxCostUsd ?? quote.maxCostUsd).toFixed(2)}</p><p className="text-[8px] text-muted-foreground">{continuing ? `remaining route estimate $${quote.estimatedCostUsd.toFixed(2)}` : `estimate $${quote.estimatedCostUsd.toFixed(2)}`}</p></div></div><div className="mt-3 flex flex-wrap gap-1.5">{quote.includes.map((item) => <span key={item} className="rounded-full border border-primary/12 px-2 py-1 text-[8px] text-primary/75">{item}</span>)}</div><div className="mt-4 flex flex-col justify-between gap-3 border-t border-white/8 pt-4 sm:flex-row sm:items-center"><p className="text-[9px] leading-4 text-muted-foreground">{continuing ? "Continue the existing approval · no new ceiling · no retry of a failed artifact" : "One explicit approval · artifacts appear as they finish · zero automatic retries"}</p>{quote.fundingSufficient === false ? <Button asChild className="w-fit rounded-full bg-primary text-primary-foreground"><a href="https://openrouter.ai/credits" target="_blank" rel="noreferrer">Add studio credit</a></Button> : continuing ? <Button disabled={busy} onClick={onApprove} className="w-fit rounded-full bg-primary text-primary-foreground"><Sparkles className="size-3.5" /> Continue {quote.itemCount} remaining artifact{quote.itemCount === 1 ? "" : "s"}</Button> : <AlertDialog><AlertDialogTrigger asChild><Button disabled={busy} className="w-fit rounded-full bg-primary text-primary-foreground"><Sparkles className="size-3.5" /> {verb} · max ${quote.maxCostUsd.toFixed(2)}</Button></AlertDialogTrigger><AlertDialogContent className="border-white/10 bg-[#12130f]"><AlertDialogHeader><AlertDialogTitle>Approve this production gate?</AlertDialogTitle><AlertDialogDescription>HAYK will create {quote.itemCount} visible artifacts with {quote.modelName}. It cannot spend above ${quote.maxCostUsd.toFixed(2)}. A failure stops on that artifact and is never retried automatically.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Not yet</AlertDialogCancel><AlertDialogAction onClick={onApprove} className="bg-primary text-primary-foreground hover:bg-primary/90">Approve up to ${quote.maxCostUsd.toFixed(2)}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</div></div>;
}

function StageApproval({ label, hint, disabled, onApprove }: { label: string; hint: string; disabled: boolean; onApprove: () => void }) {
  return <div className="mt-5 flex flex-col justify-between gap-3 border-t border-white/8 pt-4 sm:flex-row sm:items-center"><p className="max-w-2xl text-[10px] leading-5 text-muted-foreground">{hint}</p><Button disabled={disabled} onClick={onApprove} className="w-fit rounded-full bg-primary text-primary-foreground"><Check className="size-3.5" /> {label}</Button></div>;
}

function ApprovalTrail({ active, approved }: { active: ApprovalStage; approved: Set<ApprovalSection> }) {
  const steps: Array<{ id: ApprovalSection | "final"; label: string }> = [
    { id: "concept", label: "Concept" },
    { id: "language", label: "World" },
    { id: "shots", label: "Shots" },
    { id: "sound", label: "Sound" },
    { id: "final", label: "Lock" },
  ];
  return <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">{steps.map((step) => { const done = step.id === "final" ? active === "complete" : approved.has(step.id); const current = active === step.id; return <div key={step.id} className={`flex min-w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[8px] ${done ? "border-primary/20 bg-primary/8 text-primary" : current ? "border-white/18 bg-white/6 text-foreground" : "border-white/7 text-muted-foreground/55"}`}>{done ? <Check className="size-2.5" /> : <span className={`size-1.5 rounded-full ${current ? "bg-primary" : "bg-white/15"}`} />}{step.label}</div>; })}</div>;
}

function CheckpointFooter({ label, hint, onApprove, disabled = false }: { label: string; hint: string; onApprove: () => void; disabled?: boolean }) {
  return <div className="mt-5 flex flex-col justify-between gap-3 border-t border-white/7 pt-4 sm:flex-row sm:items-center"><p className="text-[10px] leading-5 text-muted-foreground">{hint}</p><Button disabled={disabled} onClick={onApprove} className="h-10 w-fit rounded-full bg-primary px-4 text-primary-foreground hover:bg-primary/90"><Check className="size-3.5" /> {label}</Button></div>;
}

function IntentPill({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex gap-3 rounded-2xl border border-white/8 bg-black/15 px-3.5 py-3"><span className="mt-0.5 text-primary/70">{icon}</span><div><p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 text-[11px] leading-4 text-[#d4d3cc]">{value}</p></div></div>;
}

function SectionLabel({ icon, title, note }: { icon: ReactNode; title: string; note: string }) {
  return <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{icon}{title}</div><span className="text-[9px] text-muted-foreground/65">{note}</span></div>;
}

function ShotCard({ shot, selected, onSelect }: { shot: ShotSpec; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition ${selected ? "border-primary/35 bg-primary/[0.075] shadow-[0_0_0_1px_rgba(217,255,87,0.08)]" : "border-white/8 bg-white/[0.025] hover:border-white/16 hover:bg-white/[0.04]"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2"><span className={`rounded-md px-2 py-1 font-mono text-[9px] ${selected ? "bg-primary text-primary-foreground" : "bg-white/6 text-muted-foreground"}`}>{shot.id}</span><span className="font-mono text-[9px] text-primary/65">{shot.time}</span></div>
        {selected && <span className="text-[9px] text-primary">Editing target</span>}
      </div>
      <h3 className="mt-3 text-sm font-medium">{shot.title}</h3>
      <p className="mt-1.5 text-[11px] leading-5 text-[#aaa9a1]">{shot.action}</p>
      <div className="mt-3 space-y-1.5 border-t border-white/7 pt-3 text-[9px] text-muted-foreground">
        <p className="flex gap-2"><Camera className="mt-0.5 size-3 shrink-0 text-primary/50" /> {shot.camera}</p>
        <p className="flex gap-2"><Volume2 className="mt-0.5 size-3 shrink-0 text-primary/50" /> {shot.sound}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">{shot.locks.slice(0, 3).map((lock) => <span key={lock} className="rounded-full border border-white/7 px-2 py-1 text-[8px] text-muted-foreground">{lock}</span>)}</div>
    </button>
  );
}

function RevisionPanel({ plan, onApplyRevision }: { plan: RevisionPlan; onApplyRevision?: () => void }) {
  return (
    <div className="border-b border-primary/12 bg-[linear-gradient(90deg,rgba(217,255,87,0.08),rgba(217,255,87,0.015))] px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-primary"><Scissors className="size-4" /> Patch map</div>
          <h3 className="mt-2 text-lg font-medium">{plan.target}</h3>
          <p className="mt-1 text-[11px] leading-5 text-[#bdbcb5]">{plan.operation}</p>
        </div>
        <Badge variant="outline" className="border-primary/20 bg-black/15 text-primary">{plan.paidRenders} paid render{plan.paidRenders === 1 ? "" : "s"}</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-primary/12 bg-black/15 p-3"><p className="text-[9px] uppercase tracking-[0.12em] text-primary/65">Change only</p><div className="mt-2 flex flex-wrap gap-1.5">{plan.layers.map((layer) => <span key={layer} className="rounded-full bg-primary/10 px-2 py-1 text-[9px] text-primary">{layer}</span>)}</div></div>
        <div className="rounded-xl border border-white/7 bg-black/15 p-3"><p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Protected master</p><p className="mt-2 text-[10px] leading-5 text-[#aaa9a1]">{plan.preserved.join(" · ")}</p></div>
      </div>
      {onApplyRevision && <Button onClick={onApplyRevision} className="mt-4 rounded-full bg-primary text-primary-foreground"><Scissors className="size-3.5" /> Apply revision</Button>}
    </div>
  );
}

function TreatmentLockDialog({ card, onLock }: { card: DirectorCard; onLock: () => Promise<void> }) {
  return (
    <Dialog>
      <DialogTrigger asChild><Button className="h-10 rounded-full bg-primary px-4 text-primary-foreground hover:bg-primary/90"><Lock className="size-3.5" /> Lock treatment</Button></DialogTrigger>
      <DialogContent className="border-white/10 bg-[#12130f] sm:max-w-[540px]">
        <DialogHeader><DialogTitle className="text-xl">Protect this production world</DialogTitle><DialogDescription className="leading-6">This freezes the approved story, assets, shot order and film language. It does not generate anything or spend money.</DialogDescription></DialogHeader>
        <div className="grid gap-2 rounded-2xl border border-white/8 bg-black/20 p-4 text-sm">
          <ApprovalRow label="Film" value={card.title} />
          <ApprovalRow label="Runtime" value={card.format} />
          <ApprovalRow label="Shots" value={`${shotsFor(card).length} separately editable`} />
          <ApprovalRow label="Future revisions" value="Smallest shot or layer only" accent />
          <ApprovalRow label="Spend now" value="$0.00" accent />
        </div>
        <DialogFooter><DialogClose asChild><Button variant="ghost">Keep directing</Button></DialogClose><DialogClose asChild><Button onClick={() => void onLock()} className="bg-primary text-primary-foreground hover:bg-primary/90">Lock the world</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Composer({
  prompt,
  setPrompt,
  references,
  busy,
  hasDirection,
  selectedShotIds,
  detectedLink,
  recording,
  inputRef,
  addFiles,
  onRemove,
  onRole,
  onSubmit,
  onRecord,
  onClearTarget,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  references: WorkingReference[];
  busy: boolean;
  hasDirection: boolean;
  selectedShotIds: string[];
  detectedLink: boolean;
  recording: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  addFiles: (files: FileList | File[]) => void;
  onRemove: (key: string) => void;
  onRole: (key: string, role: ReferenceRole) => void;
  onSubmit: () => Promise<void>;
  onRecord: () => void;
  onClearTarget: () => void;
}) {
  return (
    <div className="sticky bottom-3 z-30 mt-6">
      <div
        className="overflow-hidden rounded-[24px] border border-white/13 bg-[#12130f]/95 shadow-[0_24px_100px_rgba(0,0,0,0.6)] backdrop-blur-2xl transition focus-within:border-primary/30"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/"));
          if (files.length) addFiles(files);
        }}
      >
        {(selectedShotIds.length > 0 || detectedLink) && (
          <div className="flex items-center gap-2 border-b border-white/7 px-3 py-2">
            {selectedShotIds.length > 0 && <button type="button" onClick={onClearTarget} className="flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/8 px-2.5 py-1 text-[9px] text-primary"><Scissors className="size-3" /> Targeting {selectedShotIds.join(" + ")}<X className="size-2.5" /></button>}
            {detectedLink && <span className="flex items-center gap-1.5 rounded-full border border-white/8 bg-white/3 px-2.5 py-1 text-[9px] text-muted-foreground"><Link2 className="size-3" /> Link included</span>}
          </div>
        )}
        {references.length > 0 && (
          <div className="flex gap-2 overflow-x-auto border-b border-white/7 px-3 py-3 scrollbar-thin">
            {references.map((reference) => <ReferenceChip key={reference.key} reference={reference} onRemove={() => onRemove(reference.key)} onRole={(role) => onRole(reference.key, role)} />)}
          </div>
        )}
        <Textarea
          value={prompt}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void onSubmit();
            }
          }}
          placeholder={hasDirection ? "Describe the change. HAYK will protect everything else…" : "Share the idea—or paste a link, image, video, product page, music or raw footage…"}
          className="min-h-[82px] resize-none border-0 bg-transparent px-4 py-3.5 text-[15px] leading-6 shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-1">
            <input ref={inputRef} type="file" multiple accept="image/*,video/*,audio/*" className="hidden" onChange={(event) => event.target.files && addFiles(event.target.files)} />
            <Button type="button" variant="ghost" size="icon-sm" disabled={busy} className="rounded-full text-muted-foreground hover:text-foreground" onClick={() => inputRef.current?.click()} aria-label="Attach images, videos or audio"><Paperclip /></Button>
            <Button type="button" variant="ghost" size="icon-sm" disabled={busy} className={`rounded-full ${recording ? "bg-destructive/12 text-destructive" : "text-muted-foreground hover:text-foreground"}`} onClick={onRecord} aria-label={recording ? "Stop voice note" : "Record voice note"}>{recording ? <MicOff /> : <Mic />}</Button>
            <span className="hidden text-[10px] text-muted-foreground sm:inline">Drop, paste or record · long references are sampled locally first</span>
          </div>
          <Button type="button" size="icon-sm" className="rounded-full bg-primary text-primary-foreground shadow-[0_0_24px_rgba(217,255,87,0.16)] hover:bg-primary/90" disabled={!prompt.trim() || busy} onClick={() => void onSubmit()} aria-label="Send to HAYK">{busy ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}</Button>
        </div>
      </div>
      <p className={`mt-2 text-center text-[9px] ${busy ? "text-primary" : "text-muted-foreground/65"}`}>{busy ? "Your message and references are saved above while HAYK works." : (hasDirection ? "Add only new evidence here. Submitted references remain protected in the film history." : "Reference mapping happens on your device. No paid production starts from this composer.")}</p>
    </div>
  );
}

function ReferenceChip({ reference, onRemove, onRole }: { reference: WorkingReference; onRemove: () => void; onRole: (role: ReferenceRole) => void }) {
  const isImage = reference.mimeType.startsWith("image/");
  const isVideo = reference.mimeType.startsWith("video/");
  const isAudio = reference.mimeType.startsWith("audio/");
  return (
    <div className="relative w-[148px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/25">
      <div className="relative h-[74px] overflow-hidden bg-[#1b1c18]">
        {isImage && reference.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reference.previewUrl} alt="" className="h-full w-full object-cover" />
        ) : isVideo && reference.previewUrl ? (
          <video src={reference.previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-primary/60">{isAudio ? <Music className="size-5" /> : isVideo ? <Video className="size-5" /> : <ImageIcon className="size-5" />}</div>
        )}
        <button type="button" className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-black/70 text-white/75 hover:text-white" onClick={onRemove} aria-label={`Remove ${reference.filename}`}><X className="size-3" /></button>
      </div>
      <div className="p-2">
        <p className="truncate text-[10px] font-medium">{reference.filename}</p>
        <div className="mt-1.5 flex items-center justify-between gap-1">
          <Select value={reference.role} onValueChange={(value) => onRole(value as ReferenceRole)}>
            <SelectTrigger size="sm" className="h-6 min-w-0 flex-1 border-white/8 bg-white/4 px-2 text-[9px] shadow-none"><SelectValue /></SelectTrigger>
            <SelectContent className="border-white/10 bg-[#171813]">
              {(Object.keys(ROLE_LABELS) as ReferenceRole[]).map((role) => <SelectItem key={role} value={role} className="text-xs">{ROLE_LABELS[role]}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-[8px] text-muted-foreground">{compactDuration(reference.durationSeconds) ?? compactBytes(reference.byteSize)}</span>
        </div>
      </div>
    </div>
  );
}

function ApprovalRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className={accent ? "text-right font-medium text-primary" : "text-right text-foreground"}>{value}</span></div>;
}
