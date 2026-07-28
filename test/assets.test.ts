import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { assetUrl, hasSupportedAssetExtension, normaliseAssetPath } from "@/lib/assets";
import { assetExists, resolveAssetPath, ASSETS_DIR } from "@/lib/assets.server";
import { parseEntries } from "@/lib/import";

test("accepts ordinary relative paths and normalises them", () => {
  assert.equal(normaliseAssetPath("seed/fig.png"), "seed/fig.png");
  assert.equal(normaliseAssetPath("  seed/fig.png  "), "seed/fig.png");
  assert.equal(normaliseAssetPath("./seed//fig.png"), "seed/fig.png");
  assert.equal(normaliseAssetPath("seed\\fig.png"), "seed/fig.png");
});

test("rejects paths that escape the assets root", () => {
  // Asset paths come from imported bank files, which are untrusted input.
  for (const bad of [
    "../../etc/passwd",
    "seed/../../secret.png",
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "..",
    "",
    "   ",
    "file:///etc/passwd",
    "https://example.com/x.png",
    "data:image/png;base64,AAAA",
    "seed/\u0000fig.png",
  ]) {
    assert.equal(normaliseAssetPath(bad), null, `should have rejected: ${JSON.stringify(bad)}`);
  }
});

test("resolveAssetPath keeps traversal inside the root", () => {
  assert.equal(resolveAssetPath("../../package.json"), null);
  const inside = resolveAssetPath("seed/velocity-time-trolley.svg");
  assert.ok(inside);
  assert.ok(inside!.startsWith(fs.realpathSync(ASSETS_DIR)));
});

test("only image extensions are allowed", () => {
  assert.equal(hasSupportedAssetExtension("a/b.png"), true);
  assert.equal(hasSupportedAssetExtension("a/b.SVG"), true);
  assert.equal(hasSupportedAssetExtension("a/b.pdf"), false);
  assert.equal(hasSupportedAssetExtension("a/b.html"), false);
  assert.equal(hasSupportedAssetExtension("noextension"), false);
});

test("assetUrl percent-encodes each segment but keeps separators", () => {
  assert.equal(assetUrl("seed/fig.png"), "/api/assets/seed/fig.png");
  assert.equal(assetUrl("tys 2019/q7 fig.png"), "/api/assets/tys%202019/q7%20fig.png");
});

test("the shipped seed figure exists and is referenced correctly", () => {
  assert.equal(assetExists("seed/velocity-time-trolley.svg"), true);
  const seed = fs.readFileSync(
    path.join(process.cwd(), "data", "questions", "seed.json"),
    "utf8",
  );
  const { entries, issues } = parseEntries(
    (JSON.parse(seed).questions as unknown[]).concat(JSON.parse(seed).templates as unknown[]),
  );
  assert.deepEqual(issues, []);
  const withFigure = entries.find((e) => e.id === "seed-T2-002");
  assert.ok(withFigure, "seed-T2-002 should be in the seed bank");
  assert.equal(withFigure!.assets?.length, 1);
  assert.equal(withFigure!.assets![0].path, "seed/velocity-time-trolley.svg");
  assert.ok(withFigure!.assets![0].alt, "the shipped figure should carry a description");
});

test("import rejects unsafe, unsupported and missing figure paths", () => {
  const base = {
    topicId: "T2",
    format: "structured" as const,
    marks: 2,
    stem: "s",
    answer: "a",
  };
  const { entries, issues } = parseEntries([
    { ...base, id: "esc", assets: [{ path: "../../package.json" }] },
    { ...base, id: "ext", assets: [{ path: "seed/notes.pdf" }] },
    { ...base, id: "gone", assets: [{ path: "seed/does-not-exist.png" }] },
    { ...base, id: "fine", assets: ["seed/velocity-time-trolley.svg"] },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "fine");
  assert.equal(entries[0].assets![0].path, "seed/velocity-time-trolley.svg");
  assert.ok(issues.some((i) => i.id === "esc" && /not a safe relative path/.test(i.message)));
  assert.ok(issues.some((i) => i.id === "ext" && /not a png/.test(i.message)));
  assert.ok(issues.some((i) => i.id === "gone" && /was not found/.test(i.message)));
});

test("checkAssetFiles: false lets JSON land before the images do", () => {
  const { entries, issues } = parseEntries(
    [
      {
        id: "later",
        topicId: "T2",
        format: "structured",
        marks: 2,
        stem: "s",
        answer: "a",
        assets: [{ path: "tys2019/not-copied-yet.png" }],
      },
    ],
    { checkAssetFiles: false },
  );
  assert.deepEqual(issues, []);
  assert.equal(entries[0].assets![0].path, "tys2019/not-copied-yet.png");
  // The safety checks still apply even with the existence check off.
  const unsafe = parseEntries(
    [
      {
        id: "still-unsafe",
        topicId: "T2",
        format: "structured",
        marks: 2,
        stem: "s",
        answer: "a",
        assets: [{ path: "../escape.png" }],
      },
    ],
    { checkAssetFiles: false },
  );
  assert.equal(unsafe.entries.length, 0);
});

test("figure field aliases are accepted", () => {
  const { entries, issues } = parseEntries([
    {
      id: "alias",
      topicId: "T2",
      format: "structured",
      marks: 2,
      stem: "s",
      answer: "a",
      figure: { src: "seed/velocity-time-trolley.svg", title: "Fig. 1", description: "a graph" },
    },
  ]);
  assert.deepEqual(issues, []);
  assert.equal(entries[0].assets![0].caption, "Fig. 1");
  assert.equal(entries[0].assets![0].alt, "a graph");
});
