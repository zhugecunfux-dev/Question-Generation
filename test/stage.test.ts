import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  isValidPaperId,
  rewriteImageReference,
  stageParserOutput,
  walkParserOutput,
} from "@/lib/stage";

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "qg-stage-"));
}

/** A tiny stand-in for a parser output tree. */
function fakeParserOutput(shape: Record<string, string>): string {
  const dir = scratch();
  for (const [rel, contents] of Object.entries(shape)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return dir;
}

test("paper ids must be simple slugs", () => {
  assert.equal(isValidPaperId("tys2019-p2"), true);
  assert.equal(isValidPaperId("6091_2019.p1"), true);
  assert.equal(isValidPaperId("../escape"), false);
  assert.equal(isValidPaperId("a/b"), false);
  assert.equal(isValidPaperId(""), false);
  assert.equal(isValidPaperId("-leading"), false);
});

test("rewrites image references whatever prefix the parser used", () => {
  const cases = [
    "![](images/x.png)",
    "![](./out/images/x.png)",
    "![](x.png)",
    "![Fig 2.1](../figures/x.png)",
  ];
  for (const md of cases) {
    const { markdown, count } = rewriteImageReference(md, "x.png", "p2/fig-01.png");
    assert.equal(count, 1, md);
    assert.match(markdown, /\(p2\/fig-01\.png\)/, md);
  }
});

test("image rewriting does not disturb unrelated references or alt text", () => {
  const md = "![](images/x.png) and ![](images/y.png) and a link [x.png](http://e/x.png)";
  const { markdown, count } = rewriteImageReference(md, "x.png", "p2/fig-01.png");
  assert.equal(count, 1);
  assert.match(markdown, /!\[\]\(p2\/fig-01\.png\)/);
  assert.match(markdown, /!\[\]\(images\/y\.png\)/, "y.png must be untouched");
  assert.match(markdown, /\[x\.png\]\(http:\/\/e\/x\.png\)/, "plain links must be untouched");
});

test("basenames with regex metacharacters are matched literally", () => {
  const md = "![](out/fig(1).png)";
  const { count } = rewriteImageReference(md, "fig(1).png", "p2/fig-01.png");
  assert.equal(count, 1);
});

test("walk finds markdown and images at any depth", () => {
  const dir = fakeParserOutput({
    "auto/paper.md": "# hi",
    "auto/images/a.png": "x",
    "auto/images/nested/b.jpg": "x",
    "auto/paper_content_list.json": "[]",
  });
  const found = walkParserOutput(dir);
  assert.equal(found.markdown.length, 1);
  assert.equal(found.images.length, 2);
});

test("picks the largest markdown file when a parser emits several", () => {
  const dir = fakeParserOutput({
    "page1.md": "short",
    "full.md": "a".repeat(500),
    "page2.md": "also short",
  });
  const result = stageParserOutput({
    inputDir: dir,
    paperId: "p",
    repoRoot: scratch(),
    dryRun: true,
  });
  assert.equal(path.basename(result.markdownFile), "full.md");
});

test("stages figures into data/assets and renumbers them in reading order", () => {
  const dir = fakeParserOutput({
    "paper.md": "intro\n\n![](images/zzz-last.png)\n\n![](images/aaa-first.jpg)\n",
    "images/aaa-first.jpg": "first",
    "images/zzz-last.png": "last",
  });
  const repo = scratch();
  const result = stageParserOutput({ inputDir: dir, paperId: "tys2019-p2", repoRoot: repo });

  assert.deepEqual(
    result.figures.map((f) => f.path),
    ["tys2019-p2/fig-01.jpg", "tys2019-p2/fig-02.png"],
    "sorted by source filename, extensions preserved",
  );
  assert.equal(result.rewritten, 2);

  const staged = fs.readFileSync(path.join(dir, "staged.md"), "utf8");
  assert.match(staged, /!\[\]\(tys2019-p2\/fig-02\.png\)/);
  assert.match(staged, /!\[\]\(tys2019-p2\/fig-01\.jpg\)/);

  const assetsDir = path.join(repo, "data", "assets", "tys2019-p2");
  assert.deepEqual(fs.readdirSync(assetsDir).sort(), ["fig-01.jpg", "fig-02.png"]);
  assert.equal(fs.readFileSync(path.join(assetsDir, "fig-01.jpg"), "utf8"), "first");

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(manifest.paperId, "tys2019-p2");
  assert.equal(manifest.figures.length, 2);
});

test("dry run writes nothing", () => {
  const dir = fakeParserOutput({ "paper.md": "![](images/a.png)", "images/a.png": "x" });
  const repo = scratch();
  const result = stageParserOutput({ inputDir: dir, paperId: "p", repoRoot: repo, dryRun: true });
  assert.equal(result.figures.length, 1);
  assert.equal(fs.existsSync(path.join(repo, "data", "assets", "p")), false);
  assert.equal(fs.existsSync(path.join(dir, "staged.md")), false);
});

test("warns when figures exist but the markdown never references them", () => {
  const dir = fakeParserOutput({ "paper.md": "no images here", "images/a.png": "x" });
  const result = stageParserOutput({
    inputDir: dir,
    paperId: "p",
    repoRoot: scratch(),
    dryRun: true,
  });
  assert.equal(result.rewritten, 0);
  assert.ok(result.warnings.some((w) => /none are referenced/.test(w)));
});

test("rejects unsafe paper ids and missing directories", () => {
  assert.throws(
    () => stageParserOutput({ inputDir: scratch(), paperId: "../x", repoRoot: scratch() }),
    /simple slug/,
  );
  assert.throws(
    () =>
      stageParserOutput({
        inputDir: path.join(os.tmpdir(), "definitely-not-here-xyz"),
        paperId: "p",
        repoRoot: scratch(),
      }),
    /not found/,
  );
});

test("errors when the parser produced no markdown", () => {
  const dir = fakeParserOutput({ "images/a.png": "x" });
  assert.throws(
    () => stageParserOutput({ inputDir: dir, paperId: "p", repoRoot: scratch() }),
    /no markdown file found/,
  );
});
