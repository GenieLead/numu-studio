import type { DirectorCard, ShotSpec } from "@/lib/director";

const LOCK_SAFE_FALLBACK =
  "Apply only the observed framing, lighting and edit grammar; preserve the locked shot action and object state exactly.";

const UNCAPPED_HANDLING_GATE =
  "Bottle handling begins already uncapped; never show cap removal; the cap is completely absent until any explicitly approved capped product-only hero shot.";

function productionContractText(card: DirectorCard): string {
  return [
    card.title,
    card.creativePromise,
    card.filmGrammar.genre,
    ...card.lockedElements,
    ...card.hardGates,
    ...card.shotPlan.flatMap((shot) => [shot.title, shot.purpose, shot.action, shot.camera, ...shot.locks]),
  ].join(" ");
}

/**
 * Recover mandatory physical state gates for legacy approved directions.
 *
 * Older saved perfume directions can predate the explicit already-uncapped gate.
 * Once their shot plan contains a handled bottle and atomizer/spray action, the
 * current production contract must still apply before any paid artifact is made.
 */
export function effectiveProductionHardGates(card: DirectorCard): string[] {
  const gates = [...card.hardGates];
  const contract = productionContractText(card);
  const isHandledAtomizerSequence =
    /\b(?:bottle|perfume|fragrance|NUMU)\b/i.test(contract)
    && /\b(?:atomizer|nozzle|spray|mist)\b/i.test(contract)
    && /\b(?:hand|finger|wrist|falconer|character)\b/i.test(contract);
  if (isHandledAtomizerSequence && !gates.some((gate) => /already[- ]uncapped|never show cap removal|do not show (?:unscrewing|uncapping)/i.test(gate))) {
    gates.push(UNCAPPED_HANDLING_GATE);
  }
  return [...new Set(gates.map((gate) => gate.trim()).filter(Boolean))];
}

function lockText(card: DirectorCard): string {
  return [
    ...effectiveProductionHardGates(card),
    ...card.lockedElements,
    ...card.shotPlan.flatMap((shot) => [shot.action, ...shot.locks]),
  ].join(" ");
}

function capRemovalForbidden(card: DirectorCard): boolean {
  return /already[- ]uncapped|never show cap removal|do not show (?:unscrewing|uncapping)|cap (?:completely )?out of frame/i.test(lockText(card));
}

function proposesCapRemoval(value: string): boolean {
  return /\buncap(?:s|ping)?\b|\bunscrew(?:s|ed|ing)?\b|\bcap removal\b|\bremov(?:e|es|ed|ing|al)\b[^.!?]{0,35}\bcap\b|\btak(?:e|es|en|ing)\b[^.!?]{0,25}\bcap\b[^.!?]{0,12}\boff\b|\b(?:becomes?|gets?|turns?)\s+(?:fully\s+)?uncapped\b|\btransitions?\b[^.!?]{0,35}\bcapped\b[^.!?]{0,20}\buncapped\b/i.test(value);
}

function preservesUncappedState(value: string): boolean {
  return /already[- ]uncapped|cap (?:completely )?(?:out of frame|already off)|never show cap removal|do not show (?:unscrewing|uncapping)/i.test(value);
}

function shotRange(value: string): { start: number; end: number } | null {
  const values = [...value.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  return values.length >= 2 && values[1] > values[0] ? { start: values[0], end: values[1] } : null;
}

export function conflictsWithProductionLocks(card: DirectorCard, value: string): boolean {
  const locks = lockText(card);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  if (capRemovalForbidden(card) && proposesCapRemoval(normalized) && !preservesUncappedState(normalized)) return true;

  const coveredIdentityLocked =
    /covered (?:head|face|neck)|face and neck.*covered|never an exposed beard|do not reveal (?:the )?face/i.test(locks);
  const proposesIdentityReveal =
    /\b(?:reveal|expose|uncover)(?:s|ed|ing)?\b[^.!?]{0,35}\b(?:face|hair|mouth|beard|neck)\b|\b(?:bare|visible|uncovered) (?:face|hair|mouth|beard|neck)\b/i.test(normalized);
  const preservesCoveredIdentity =
    /(?:do not|don't|never|avoid)\b[^.!?]{0,25}\b(?:reveal|expose|uncover)\b[^.!?]{0,35}\b(?:face|hair|mouth|beard|neck)\b/i.test(normalized);
  if (coveredIdentityLocked && proposesIdentityReveal && !preservesCoveredIdentity) return true;

  return false;
}

export function lockSafeProductionShot(card: DirectorCard, shot: ShotSpec): ShotSpec {
  let next: ShotSpec = { ...shot, locks: [...shot.locks] };
  if (capRemovalForbidden(card)) {
    const text = [shot.title, shot.purpose, shot.action, shot.camera, ...shot.locks].join(" ");
    const isCapTransition = proposesCapRemoval(text) && !preservesUncappedState(text);
    if (isCapTransition) {
      next = {
        ...next,
        title: "The Nozzle Set",
        purpose: "Show deliberate preparation without changing the already approved product state.",
        action: "The exact NUMU bottle is already uncapped in the falconer's right hand. In one precise motion, his right index finger settles onto the exposed atomizer without pressing it. The cap is completely absent and never enters frame.",
        camera: "Extreme close-up of the exposed NUMU atomizer and right index finger. Keep the bottle geometry and nozzle legible against a softly blurred desert background.",
        sound: "Dry fingertip contact and restrained click-free handling",
        locks: [
          "exact NUMU bottle geometry and exposed atomizer",
          "right hand maintains one achievable grip",
          "already uncapped; cap completely absent; no spray yet",
        ],
      };
    } else if (/\bcapped\b/i.test(text) && /\b(?:falconer|character|hand|holds?)\b/i.test(text)) {
      next = {
        ...next,
        action: next.action
          .replace(/\bthe capped,?\s+(?:black\s+)?NUMU bottle\b/i, "the already-uncapped black NUMU bottle")
          .replace(/\ba capped,?\s+(?:black\s+)?NUMU bottle\b/i, "an already-uncapped black NUMU bottle")
          .replace(/\bcapped,?\s+(?:black\s+)?NUMU bottle\b/i, "already-uncapped black NUMU bottle"),
        locks: next.locks.map((lock) => /\bcapped\b/i.test(lock)
          ? "PRODUCT: Already-uncapped NUMU bottle; exposed atomizer visible; cap completely absent."
          : lock),
      };
    }
  }
  if (/same close-up position as S01-03/i.test(next.camera)) {
    next = {
      ...next,
      camera: "Continue the left-wrist close-up established in S03. Keep the right hand, exposed atomizer, receiving left wrist and the falcon's subtle eye-line visible in one physically achievable composition.",
    };
  }
  return next;
}

export function lockSafeProductionShotPlan(card: DirectorCard): ShotSpec[] {
  const shots = card.shotPlan.map((shot) => lockSafeProductionShot(card, shot));
  const last = shots.at(-1);
  const range = last ? shotRange(last.time) : null;
  if (!last || !range || Math.abs(range.end - card.deliverySeconds) <= 0.05) return shots;
  return shots.map((shot, index) => index === shots.length - 1
    ? { ...shot, time: `${range.start.toFixed(1)}s - ${card.deliverySeconds.toFixed(1)}s` }
    : shot);
}

export function productionLockIssues(card: DirectorCard): string[] {
  const issues: string[] = [];
  for (const shot of card.shotPlan) {
    const text = [shot.title, shot.purpose, shot.action, shot.camera, ...shot.locks].join(" ");
    if (conflictsWithProductionLocks(card, text)) issues.push(`${shot.id} conflicts with a global identity or object-state lock.`);
  }
  const ranges = card.shotPlan.map((shot) => shotRange(shot.time));
  if (ranges.some((range) => !range)) issues.push("One or more shot time ranges are invalid.");
  const valid = ranges.filter((range): range is { start: number; end: number } => Boolean(range));
  if (valid.length === card.shotPlan.length && valid.length) {
    if (Math.abs(valid[0].start) > 0.05) issues.push("The shot plan does not begin at 0.0 seconds.");
    for (let index = 1; index < valid.length; index += 1) {
      if (Math.abs(valid[index].start - valid[index - 1].end) > 0.05) issues.push(`The shot plan has a gap or overlap before ${card.shotPlan[index].id}.`);
    }
    if (Math.abs(valid.at(-1)!.end - card.deliverySeconds) > 0.05) issues.push(`The shot plan ends at ${valid.at(-1)!.end.toFixed(1)}s instead of ${card.deliverySeconds.toFixed(1)}s.`);
  }
  return [...new Set(issues)];
}

export function safeProductionTranslations(card: DirectorCard, value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .filter((item) => !conflictsWithProductionLocks(card, item));
}

export function guardEvidenceDossier<T extends object>(card: DirectorCard, dossier: T): T {
  const record = dossier as Record<string, unknown>;
  const rejected: string[] = [];
  const visualFindings = Array.isArray(record.visualFindings)
    ? record.visualFindings.map((item) => {
        if (!item || typeof item !== "object") return item;
        const finding = item as Record<string, unknown>;
        const productionUse = typeof finding.productionUse === "string" ? finding.productionUse : "";
        if (!conflictsWithProductionLocks(card, productionUse)) return item;
        rejected.push(productionUse);
        return { ...finding, productionUse: LOCK_SAFE_FALLBACK };
      })
    : record.visualFindings;
  const originalTranslations = Array.isArray(record.productionTranslations)
    ? record.productionTranslations.filter((item): item is string => typeof item === "string")
    : [];
  const productionTranslations = originalTranslations.filter((item) => {
    const conflict = conflictsWithProductionLocks(card, item);
    if (conflict) rejected.push(item);
    return !conflict;
  });
  const forbiddenTransfers = [
    ...(Array.isArray(record.forbiddenTransfers)
      ? record.forbiddenTransfers.filter((item): item is string => typeof item === "string")
      : []),
    ...rejected.map((item) => `Rejected because it conflicts with the locked action state: ${item}`),
  ].slice(0, 12);

  return {
    ...record,
    visualFindings,
    productionTranslations,
    forbiddenTransfers,
  } as T;
}
