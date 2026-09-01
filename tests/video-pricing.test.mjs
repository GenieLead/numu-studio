import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

const { selectPricePerSecond, selectVideoPricePerSecond } = await vite.ssrLoadModule("/lib/video-pricing.ts");

test("reads OpenRouter's current generic video generation SKU", () => {
  assert.equal(selectPricePerSecond({ generate: "0.03" }), 0.03);
});

test("prefers the exact 720p no-audio video SKU", () => {
  assert.equal(
    selectPricePerSecond({
      generate: "0.05",
      "per_video_second_1080p": "0.08",
      "per_video_second_720p_no_audio": "0.03",
    }),
    0.03,
  );
});

test("fails closed when multiple unfamiliar pricing units are present", () => {
  assert.equal(selectPricePerSecond({ input: "0.000001", output: "0.000002" }), null);
});

test("converts Seedance's live 720p audio token SKU to its exact per-second price", () => {
  assert.equal(
    selectVideoPricePerSecond(
      {
        video_tokens: "0.0000107",
        video_tokens_without_audio: "0.0000107",
        video_tokens_with_video_input: "0.0000064",
      },
      { resolution: "720p", audio: true },
    ),
    0.23112,
  );
});

test("uses the separate Seedance video-input rate only when a video reference is sent", () => {
  assert.equal(
    selectVideoPricePerSecond(
      { "seedance:video_tokens_with_video_input": "0.0000064" },
      { resolution: "720p", audio: true, videoInput: true },
    ),
    0.13824,
  );
});

test("reads Wan's resolution-specific duration price", () => {
  assert.equal(
    selectVideoPricePerSecond(
      {
        duration_seconds_480p: "0.05",
        duration_seconds_720p: "0.1",
        duration_seconds_1080p: "0.2",
      },
      { resolution: "720p", audio: true },
    ),
    0.1,
  );
});
