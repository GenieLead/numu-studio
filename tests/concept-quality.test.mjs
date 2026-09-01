import assert from "node:assert/strict";
import test from "node:test";

import { evaluateConceptQuality, referenceTimestampSeconds } from "../lib/concept-quality.ts";

const strategy = {
  humanInsight: "People seek a personal ritual that turns private intention into a visible act they can remember.",
  centralTension: "A disciplined gesture resists the uncontrolled environment while remaining physically observable.",
  creativeMechanism: "The protected object creates a specific repeatable gesture whose cause and effect can be photographed in camera.",
  emotionalArc: "The audience moves from uncertainty to recognition as the action resolves into a precise repeatable symbol.",
  memoryDevice: "A specific object, gesture and recurring image remain as a signature the viewer can recall after the film.",
  audiencePsychology: "The viewer recognizes self-command through an action rather than through an unsupported advertising claim.",
  brandOwnership: "Only the exact protected identity can own the gesture; replacing it with a competitor collapses the mechanism.",
  referenceConnection: "The restrained framing at 0:03 establishes control, while the tactile acceleration at 0:05 motivates the reveal.",
  distinctivenessProof: "Replace the exact object or person and the mechanism loses its specific cause, meaning and recognizable brand signature.",
};

test("normalizes clock and seconds-style reference citations", () => {
  assert.deepEqual(referenceTimestampSeconds("At 0:03, 00:05.250 and 6s, then 6 seconds."), [3, 5.25, 6]);
});

test("accepts two distinct clock-style sampled video timestamps", () => {
  const quality = evaluateConceptQuality(strategy, 18);
  assert.equal(quality.issues.some((issue) => issue.includes("timestamp")), false);
  assert.equal(quality.status, "passed");
});

test("keeps timestamp evidence as a hard gate when only one moment is cited", () => {
  const quality = evaluateConceptQuality({ ...strategy, referenceConnection: "The restrained framing at 0:03 establishes control." }, 18);
  assert.equal(quality.issues.some((issue) => issue.includes("timestamp")), true);
  assert.equal(quality.status, "needs-revision");
});

test("recognizes observable contrast and a concrete visual shadow motif", () => {
  const quality = evaluateConceptQuality({
    ...strategy,
    centralTension: "The untamable desert is contrasted with one precise, controlled action.",
    memoryDevice: "A sharp geometric shadow in the exact shape of the protected object becomes the precise target for one spray.",
  }, 18);
  assert.deepEqual(quality.issues, []);
  assert.equal(quality.status, "passed");
});

test("recognizes an observable force held in balance by a precise counter-action", () => {
  const quality = evaluateConceptQuality({
    ...strategy,
    centralTension: "The vast, untamable power of the desert sun and a wild falcon are held in balance by the calm, measured precision of a single human gesture.",
  }, 18);
  assert.deepEqual(quality.issues, []);
  assert.equal(quality.status, "passed");
});

test("never reports a pass while any automated issue remains", () => {
  const quality = evaluateConceptQuality({ ...strategy, centralTension: "Control becomes visible through a single precise act." }, 18);
  assert.ok(quality.score >= 80);
  assert.ok(quality.issues.length > 0);
  assert.equal(quality.status, "needs-revision");
});
