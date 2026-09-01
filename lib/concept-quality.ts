import type { ConceptQuality, ConceptStrategy } from "./director.ts";

export function referenceTimestampSeconds(value: string): number[] {
  const seconds: number[] = [];
  for (const match of value.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:s|sec(?:ond)?s?)\b/gi)) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) seconds.push(parsed);
  }
  for (const match of value.matchAll(/(?<![\d:])(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)(?![\d:])/g)) {
    const hours = match[1] === undefined ? 0 : Number(match[1]);
    const minutes = Number(match[2]);
    const clockSeconds = Number(match[3]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(clockSeconds)) continue;
    if (clockSeconds >= 60 || (match[1] !== undefined && minutes >= 60)) continue;
    seconds.push(hours * 3600 + minutes * 60 + clockSeconds);
  }
  return [...new Set(seconds.map((second) => Number(second.toFixed(3))))].sort((left, right) => left - right);
}

export function evaluateConceptQuality(strategy: ConceptStrategy, storyboardFrameCount: number): ConceptQuality {
  const issues: string[] = [];
  const entries = Object.entries(strategy);
  const shortFields = entries.filter(([, value]) => value.trim().length < 45).map(([key]) => key);
  if (shortFields.length) issues.push(`Underdeveloped: ${shortFields.join(", ")}`);
  if (!/\b(but|while|versus|against|between|without|yet|although|resists?|tension|conflict|contrast(?:s|ed|ing)?|oppos(?:e|es|ed|ing|ition)|(?:held\s+in\s+)?balance(?:d)?\s+by|counter(?:s|ed)?\s+by|checked\s+by|restrained\s+by|answered\s+by|juxtaposed\s+with|pitted\s+against|collides?\s+with|confronts?)\b/i.test(strategy.centralTension)) {
    issues.push("The central tension does not express an observable opposition");
  }
  if (!/\b(remember|recall|recogn|repeat|transform|remain|trace|signature|symbol|motif|image|sound|gesture|object|shadow|shape|silhouette|pattern|mark|line|texture|colou?r|light|reflection|movement|target|surface|rhythm)\b/i.test(strategy.memoryDevice)) {
    issues.push("The memory device is not concrete enough to survive after viewing");
  }
  if (!/\b(only|own|cannot|collapse|depend|specific|exact|replace|substitut|competitor|brand)\b/i.test(`${strategy.brandOwnership} ${strategy.distinctivenessProof}`)) {
    issues.push("The concept has not proved why another brand cannot own it");
  }
  if (storyboardFrameCount > 0 && referenceTimestampSeconds(strategy.referenceConnection).length < 2) {
    issues.push("The reference connection does not cite at least two sampled video timestamps");
  }
  const genericHits = (`${strategy.humanInsight} ${strategy.creativeMechanism} ${strategy.memoryDevice}`.match(/\b(luxury|premium|cinematic|unforgettable|captivating|beautiful|elegant)\b/gi) ?? []).length;
  if (genericHits > 4) issues.push("The concept relies too heavily on generic advertising adjectives");
  const score = Math.max(0, 100 - shortFields.length * 12 - Math.max(0, issues.length - (shortFields.length ? 1 : 0)) * 15);
  return { status: score >= 80 && issues.length === 0 ? "passed" : "needs-revision", score, issues };
}
