import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

const basePrompt =
  "Use case: scientific-educational. Create a clean side-view illustration of a horizontal wooden beam resting on a triangular metal pivot against a plain white studio background. Put the pivot landmark at (300, 280), keep the full beam visible, and reserve clear empty zones above both ends and below the pivot for a later exact vector overlay. Use neutral materials, crisp outlines, soft even lighting, and a 640 by 420 landscape composition. No text, no labels, no numbers, no arrows, no dimensions, no watermark.";

test("ImageGen job preserves a deterministic fallback and composites the exact overlay", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qg-imagegen-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  process.env.QG_ASSETS_DIR = root;

  const {
    buildImagegenHandoffPrompt,
    completeImagegenJob,
    createImagegenJob,
    readImagegenJob,
  } = await import("@/lib/imagegen-jobs.server");

  const dir = path.join(root, "generated", "paper");
  fs.mkdirSync(dir, { recursive: true });
  const fallbackPath = "generated/paper/q1-fallback.svg";
  const overlayPath = "generated/paper/q1-overlay.svg";
  const outputPath = "generated/paper/q1.png";
  const basePath = "generated/paper/q1-base.png";
  const jobPath = "generated/paper/q1.imagegen.json";
  fs.writeFileSync(
    path.join(root, fallbackPath),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420"><rect width="640" height="420" fill="white"/></svg>',
  );
  fs.writeFileSync(
    path.join(root, overlayPath),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420"><text x="80" y="80" fill="black">12 N</text></svg>',
  );
  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#FFFFFF",
    },
  })
    .png()
    .toFile(path.join(root, outputPath));
  const sourceBase = path.join(root, "source-base.png");
  await sharp({
    create: {
      width: 320,
      height: 210,
      channels: 3,
      background: "#DDE6F2",
    },
  })
    .png()
    .toFile(sourceBase);

  createImagegenJob(jobPath, {
    id: "paper-q1",
    questionId: "question-q1",
    topicId: "T4",
    width: 640,
    height: 420,
    prompt: basePrompt,
    overlayPath,
    fallbackPath,
    outputPath,
    basePath,
  });
  assert.equal(readImagegenJob(jobPath).status, "pending");
  const handoff = buildImagegenHandoffPrompt([jobPath]);
  assert.match(handoff, /built-in image_gen/);
  assert.match(handoff, /do not use an API/i);
  assert.match(handoff, /imagegen:complete/);
  assert.match(handoff, /--fail/);

  const completed = await completeImagegenJob(jobPath, sourceBase);
  assert.equal(completed.status, "ready");
  assert.equal(fs.existsSync(path.join(root, basePath)), true);
  const metadata = await sharp(path.join(root, outputPath)).metadata();
  assert.equal(metadata.width, 640);
  assert.equal(metadata.height, 420);
});
