function unwrapJson(content: string): string {
  const direct = content.trim().replace(/^\uFEFF/, "");
  const fenced = direct.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || direct;
  const objectStart = candidate.indexOf("{");
  const objectEnd = candidate.lastIndexOf("}");
  const arrayStart = candidate.indexOf("[");
  const arrayEnd = candidate.lastIndexOf("]");

  if (objectStart >= 0 && objectEnd > objectStart && (arrayStart < 0 || objectStart < arrayStart)) {
    return candidate.slice(objectStart, objectEnd + 1);
  }
  if (arrayStart >= 0 && arrayEnd > arrayStart) return candidate.slice(arrayStart, arrayEnd + 1);
  return candidate;
}

function errorPosition(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/position\s+(\d+)/i);
  if (!match) return null;
  const position = Number(match[1]);
  return Number.isInteger(position) ? position : null;
}

function insertMissingComma(candidate: string, position: number): string | null {
  let before = Math.min(position - 1, candidate.length - 1);
  while (before >= 0 && /\s/.test(candidate[before] ?? "")) before -= 1;

  let after = Math.min(position, candidate.length);
  while (after < candidate.length && /\s/.test(candidate[after] ?? "")) after += 1;

  const previous = candidate[before] ?? "";
  const next = candidate[after] ?? "";
  const valueCanEnd = /["}\]0-9eE]/.test(previous) || candidate.slice(Math.max(0, before - 4), before + 1).match(/(?:true|false|null)$/);
  const valueCanStart = /["{\[0-9tfn-]/.test(next);

  if (!valueCanEnd || !valueCanStart || previous === ",") return null;
  return `${candidate.slice(0, before + 1)},${candidate.slice(before + 1)}`;
}

/**
 * Parses model-authored JSON without another model call. The repair is deliberately
 * narrow: it only removes trailing commas or inserts an omitted comma at the exact
 * position reported by the runtime parser.
 */
export function parseJsonWithLocalRepair(content: string): unknown {
  let candidate = unwrapJson(content);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      const withoutTrailingCommas = candidate.replace(/,\s*([}\]])/g, "$1");
      if (withoutTrailingCommas !== candidate) {
        candidate = withoutTrailingCommas;
        continue;
      }

      const position = errorPosition(error);
      const repaired = position === null ? null : insertMissingComma(candidate, position);
      if (!repaired || repaired === candidate) throw error;
      candidate = repaired;
    }
  }

  return JSON.parse(candidate);
}
