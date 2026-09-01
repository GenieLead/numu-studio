import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductionPrompt,
  createDirectorCard,
  createRevisionPlan,
  explicitFilmRuntimeSeconds,
  mergeShotRevision,
  revisionShotIds,
  storyBeatsFromShots,
} from "../lib/director.ts";
import {
  conflictsWithProductionLocks,
  effectiveProductionHardGates,
  guardEvidenceDossier,
  lockSafeProductionShotPlan,
  productionLockIssues,
  safeProductionTranslations,
} from "../lib/production-guardrails.ts";

function shot(id, action) {
  return {
    id,
    time: "0.0s – 1.0s",
    title: id,
    purpose: `${id} purpose`,
    action,
    camera: `${id} camera`,
    sound: `${id} sound`,
    route: `${id} route`,
    locks: [`${id} lock`],
  };
}

test("extracts only the explicitly revised shots", () => {
  const prompt = "Revise only S03 and S04. Preserve S01, S02 and S05 exactly.";
  assert.deepEqual(revisionShotIds(prompt), ["S03", "S04"]);
  assert.deepEqual(revisionShotIds("Revise S03 and S04 only. Preserve S01."), ["S03", "S04"]);
  assert.deepEqual(revisionShotIds(prompt, ["s04", "S03", "S04"]), ["S03", "S04"]);
});

test("merges only requested shots into the protected master", () => {
  const previous = [shot("S01", "locked one"), shot("S02", "locked two"), shot("S03", "old three"), shot("S04", "old four"), shot("S05", "locked five")];
  const generated = [shot("S03", "new three"), shot("S04", "new four")];
  const merged = mergeShotRevision(previous, generated, ["S03", "S04"]);

  assert.strictEqual(merged[0], previous[0]);
  assert.strictEqual(merged[1], previous[1]);
  assert.strictEqual(merged[4], previous[4]);
  assert.equal(merged[2].action, "new three");
  assert.equal(merged[3].action, "new four");
  assert.deepEqual(storyBeatsFromShots(merged).map((beat) => beat.beat), ["S01: locked one", "S02: locked two", "S03: new three", "S04: new four", "S05: locked five"]);
});

test("fails closed when a requested revision is missing", () => {
  const previous = [shot("S03", "old three"), shot("S04", "old four")];
  assert.throws(() => mergeShotRevision(previous, [shot("S03", "new three")], ["S03", "S04"]), /Nothing changed/);
});

test("classifies multi-shot choreography instead of color grading", () => {
  const plan = createRevisionPlan("Revise only S03 and S04. Keep the approved lighting.");
  assert.equal(plan.target, "S03 + S04 only");
  assert.equal(plan.operation, "Replace only the requested shot choreography");
  assert.deepEqual(plan.layers, ["action", "camera", "object physics"]);
  assert.equal(plan.paidRenders, 0);
});

test("classifies an unapproved concept rewrite without inventing a shot patch", () => {
  const plan = createRevisionPlan("Redesign the concept only. Preserve every reference.", [], "concept");
  assert.equal(plan.target, "Concept strategy only");
  assert.match(plan.operation, /unapproved idea/);
  assert.doesNotMatch(plan.target, /shot/i);
  assert.equal(plan.paidRenders, 0);
});

test("turns perfume identity and action conflicts into hard production gates", () => {
  const card = createDirectorCard(
    "Create an 8-second NUMU perfume film from this 40-second visual reference.",
    [
      { id: "product", role: "product" },
      { id: "character", role: "character" },
      { id: "style", role: "style", durationSeconds: 40 },
    ],
  );
  card.referenceIntelligence = {
    ...card.referenceIntelligence,
    status: "analyzed",
    styleDNA: ["Rapid graphic hard cuts", "Black-white contrast with restrained amber product light"],
  };

  assert.equal(card.referenceAnalysis.localStoryboardFrames, 16);
  assert.equal(card.referenceAnalysis.deepPassSeconds, 8);
  assert.match(card.referenceAnalysis.strategy, /global frames/);
  assert.match(card.referenceAnalysis.strategy, /dense frames/);
  assert.match(card.shotPlan.find((shot) => shot.id === "S04")?.action ?? "", /exposed wrist/);
  assert.match(card.shotPlan.find((shot) => shot.id === "S04")?.action ?? "", /already uncapped/);
  assert.match(card.hardGates.join(" "), /never a tall, flared or chalice-shaped cap/);
  assert.match(card.hardGates.join(" "), /never an exposed beard, crew-neck shirt or substitute actor/);

  const prompt = buildProductionPrompt(card);
  assert.match(prompt, /centered upright frontal view is the canonical geometry master/);
  assert.match(prompt, /Never average, merge or morph the views/);
  assert.match(prompt, /fragrance is applied only to the exposed wrist/);
  assert.match(prompt, /Do not show unscrewing or cap removal/);
  assert.match(prompt, /Rapid graphic hard cuts/);
  assert.match(prompt, /Do not replace this grammar with a generic bright-blue-sky desert lifestyle montage/);
});

test("rejects evidence suggestions that contradict locked action and identity states", () => {
  const card = createDirectorCard("Create an 8-second NUMU perfume film.", []);
  const unsafeUncap = "Cut to a tight close-up on the thumb uncapping the bottle in S02.";
  const safeState = "Start already uncapped with the cap completely out of frame.";
  const unsafeReveal = "Reveal the character's face and visible beard for emotional connection.";
  const unsafeWithUnrelatedNegation = "Use a fast cut to ECU uncapping to communicate control, not romance.";

  assert.equal(conflictsWithProductionLocks(card, unsafeUncap), true);
  assert.equal(conflictsWithProductionLocks(card, unsafeReveal), true);
  assert.equal(conflictsWithProductionLocks(card, unsafeWithUnrelatedNegation), true);
  assert.equal(conflictsWithProductionLocks(card, safeState), false);
  assert.deepEqual(safeProductionTranslations(card, [unsafeUncap, safeState]), [safeState]);

  const guarded = guardEvidenceDossier(card, {
    visualFindings: [{ observation: "Fast hard cut", productionUse: unsafeUncap }],
    productionTranslations: [unsafeUncap, safeState],
    forbiddenTransfers: [],
  });
  assert.doesNotMatch(guarded.visualFindings[0].productionUse, /uncapping/i);
  assert.deepEqual(guarded.productionTranslations, [safeState]);
  assert.match(guarded.forbiddenTransfers.join(" "), /conflicts with the locked action state/);
});

test("repairs stale shot actions against global locks before paid production", () => {
  const card = createDirectorCard("Create an 8-second NUMU perfume film.", []);
  card.deliverySeconds = 8;
  card.hardGates = ["Preserve the exact approved product and character identities."];
  card.shotPlan = [
    {
      ...shot("S01", "The falconer holds the capped, black NUMU bottle in his right hand."),
      time: "0.0s - 2.0s",
      locks: ["PRODUCT: Capped NUMU bottle, held in right hand."],
    },
    {
      ...shot("S02", "The falconer's thumb pushes the cap off the NUMU bottle. The cap lifts slightly."),
      time: "2.0s - 2.5s",
      title: "The Uncapping",
      camera: "Extreme close-up on the cap.",
      locks: ["STATE: Bottle transitions from capped to uncapped."],
    },
    { ...shot("S03", "The already uncapped bottle casts a normal sunlight shadow over the wrist."), time: "2.5s - 5.0s" },
    {
      ...shot("S04", "One fine colorless mist reaches the wrist."),
      time: "5.0s - 7.0s",
      camera: "The camera remains in the same close-up position as S01-03.",
    },
  ];

  assert.match(effectiveProductionHardGates(card).join(" "), /begins already uncapped/);
  assert.match(productionLockIssues(card).join(" "), /S02 conflicts|ends at 7\.0s/);
  const safe = lockSafeProductionShotPlan(card);
  assert.match(safe[0].action, /already-uncapped/);
  assert.equal(safe[1].title, "The Nozzle Set");
  assert.match(safe[1].action, /already uncapped/);
  assert.doesNotMatch(safe[1].action, /pushes the cap|cap lifts/i);
  assert.equal(safe[2].title, "S03");
  assert.equal(safe[2].action, "The already uncapped bottle casts a normal sunlight shadow over the wrist.");
  assert.match(safe[3].camera, /established in S03/);
  assert.equal(safe[3].time, "5.0s - 8.0s");

  assert.deepEqual(productionLockIssues({ ...card, shotPlan: safe }), []);
});

test("does not confuse expensive perfume language with a pen-writing film", () => {
  const prompt = "Create an 8-second vertical cinematic perfume film that feels tactile and expensive, not synthetic.";
  const card = createDirectorCard(prompt, []);
  assert.equal(explicitFilmRuntimeSeconds(prompt), 8);
  assert.equal(card.deliverySeconds, 8);
  assert.equal(card.referenceAnalysis.requestedRuntimeSeconds, 8);
  assert.match(card.format, /^8-second/);
  assert.equal(card.filmGrammar.genre, "Luxury desert ritual");
});
