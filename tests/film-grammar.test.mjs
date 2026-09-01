import assert from "node:assert/strict";
import test from "node:test";

import { repairFilmGrammar } from "../lib/film-grammar.ts";

test("removes character-limit fragments from saved visual-world prose", () => {
  const repaired = repairFilmGrammar({
    genre: "Cinematic Luxury Perfume",
    era: "Contemporary",
    tempo: "Deliberate and escalating. Starts slow, builds with quick tactile cuts, and resolves on a static, p",
    camera: "Mix of locked-off wide shots and motivated close-ups. Stable and controlled.",
    lens: "Shallow depth of field to isolate textures. Telephoto compression for portraits and wide establishing shots. Graphic",
    lighting: "Hard desert sunlight creates sharp shadows. Sculpted low-key studio light for the final",
    palette: "Desert ochre, deep sky blue, and absolute black define the world. Warm skin tones provide a warm",
  });

  assert.equal(repaired.tempo, "Deliberate and escalating.");
  assert.equal(repaired.camera, "Mix of locked-off wide shots and motivated close-ups. Stable and controlled.");
  assert.equal(repaired.lens, "Shallow depth of field to isolate textures. Telephoto compression for portraits and wide establishing shots.");
  assert.equal(repaired.lighting, "Hard desert sunlight creates sharp shadows.");
  assert.equal(repaired.palette, "Desert ochre, deep sky blue, and absolute black define the world.");
});
