import type { FilmGrammar } from "./director.ts";

const descriptiveFields = ["tempo", "camera", "lens", "lighting", "palette"] as const;

function removeTruncatedTail(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[.!?]["')\]]?$/.test(trimmed) || trimmed.length < 64) return trimmed;

  const endings = [...trimmed.matchAll(/[.!?](?=\s|$)/g)];
  const lastComplete = endings.at(-1)?.index;
  if (lastComplete !== undefined && lastComplete >= 24) return trimmed.slice(0, lastComplete + 1);

  return `${trimmed.replace(/[,:;\-–—]+\s*$/, "")}.`;
}

/**
 * Structured-output providers can satisfy a JSON maxLength by ending a value
 * at the character boundary. Keep only complete prose before it reaches the
 * approval UI or a downstream shot-planning prompt.
 */
export function repairFilmGrammar(grammar: FilmGrammar): FilmGrammar {
  const repaired: FilmGrammar = {
    genre: grammar.genre.trim(),
    era: grammar.era.trim(),
    tempo: grammar.tempo.trim(),
    camera: grammar.camera.trim(),
    lens: grammar.lens.trim(),
    lighting: grammar.lighting.trim(),
    palette: grammar.palette.trim(),
  };
  for (const field of descriptiveFields) repaired[field] = removeTruncatedTail(repaired[field]);
  return repaired;
}
