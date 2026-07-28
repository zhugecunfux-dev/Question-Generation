/**
 * Normalises a PDF parser's output into the shape the importer expects.
 *
 * MinerU, Marker, Docling and PyMuPDF4LLM all emit "a Markdown file plus a
 * folder of figures", but each names the folder differently and writes image
 * references with a different prefix. This walks the output, renumbers the
 * figures into reading order, copies them under `data/assets/<paperId>/`, and
 * rewrites the Markdown references to the `<paperId>/fig-NN.ext` form that
 * `assets[].path` uses.
 */

import fs from "node:fs";
import path from "node:path";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MARKDOWN_EXT = new Set([".md", ".markdown", ".mmd"]);

export interface StagedFigure {
  /** Value to use as `assets[].path`, e.g. "tys2019-p2/fig-01.png". */
  path: string;
  sourceFile: string;
  bytes: number;
}

export interface StageResult {
  paperId: string;
  markdownFile: string;
  markdown: string;
  figures: StagedFigure[];
  /** How many image references in the Markdown were repointed. */
  rewritten: number;
  warnings: string[];
}

export function isValidPaperId(paperId: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(paperId) && !paperId.includes("..");
}

export function walkParserOutput(dir: string): { markdown: string[]; images: string[] } {
  const out = { markdown: [] as string[], images: [] as string[] };
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (MARKDOWN_EXT.has(ext)) out.markdown.push(full);
      else if (IMAGE_EXT.has(ext)) out.images.push(full);
    }
  };
  visit(dir);
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Repoint every Markdown image reference whose target ends in `basename`.
 *
 * Parsers write `![](images/x.png)`, `![](./out/images/x.png)` or a bare
 * `![](x.png)` depending on their settings, so match on the trailing basename
 * rather than the whole path.
 */
export function rewriteImageReference(
  markdown: string,
  basename: string,
  replacement: string,
): { markdown: string; count: number } {
  let count = 0;
  const pattern = new RegExp(
    `(!\\[[^\\]]*\\]\\()([^)]*${escapeRegExp(basename)})(\\))`,
    "g",
  );
  const next = markdown.replace(pattern, (_m, open: string, _old: string, close: string) => {
    count++;
    return `${open}${replacement}${close}`;
  });
  return { markdown: next, count };
}

export interface StageOptions {
  inputDir: string;
  paperId: string;
  /** Repo root; `data/assets/<paperId>` is resolved against it. */
  repoRoot: string;
  /** Compute the result without touching the filesystem. */
  dryRun?: boolean;
}

export function stageParserOutput(options: StageOptions): StageResult {
  const { inputDir, paperId, repoRoot, dryRun = false } = options;
  const warnings: string[] = [];

  if (!isValidPaperId(paperId)) {
    throw new Error(`paperId "${paperId}" must be a simple slug (letters, digits, . _ -)`);
  }
  if (!fs.existsSync(inputDir)) throw new Error(`${inputDir}: not found`);

  const found = walkParserOutput(inputDir);
  if (found.markdown.length === 0) {
    throw new Error(`${inputDir}: no markdown file found — did the parser finish?`);
  }

  // Parsers may emit several .md files (one per page, or a sidecar). The
  // largest is the full document.
  const markdownFile = found.markdown
    .map((f) => ({ f, size: fs.statSync(f).size }))
    .sort((a, b) => b.size - a.size || a.f.localeCompare(b.f))[0].f;

  let markdown = fs.readFileSync(markdownFile, "utf8");
  const figures: StagedFigure[] = [];
  let rewritten = 0;

  const sorted = found.images.slice().sort();
  sorted.forEach((image, i) => {
    const ext = path.extname(image).toLowerCase();
    // Parser filenames are hashes or page offsets; renumber to reading order.
    const staged = `fig-${String(i + 1).padStart(2, "0")}${ext}`;
    const result = rewriteImageReference(markdown, path.basename(image), `${paperId}/${staged}`);
    markdown = result.markdown;
    rewritten += result.count;
    figures.push({
      path: `${paperId}/${staged}`,
      sourceFile: path.basename(image),
      bytes: fs.statSync(image).size,
    });
  });

  if (figures.length > 0 && rewritten === 0) {
    warnings.push(
      "figures were found but none are referenced from the markdown — " +
        "check the parser's image path settings before structuring",
    );
  }
  if (figures.length === 0) {
    warnings.push("no figures were extracted — expected for a text-only paper, suspicious otherwise");
  }

  if (!dryRun) {
    const assetsDir = path.join(repoRoot, "data", "assets", paperId);
    fs.mkdirSync(assetsDir, { recursive: true });
    sorted.forEach((image, i) => {
      fs.copyFileSync(image, path.join(assetsDir, path.basename(figures[i].path)));
    });
    fs.writeFileSync(path.join(inputDir, "staged.md"), markdown);
    fs.writeFileSync(
      path.join(inputDir, "manifest.json"),
      JSON.stringify({ paperId, markdownFile, figures }, null, 2),
    );
  }

  return { paperId, markdownFile, markdown, figures, rewritten, warnings };
}
