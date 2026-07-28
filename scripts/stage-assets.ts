/**
 * Stage a PDF parser's output for import.
 *
 *   npm run stage -- --in out/6091_2019_p2 --paper-id tys2019-p2
 *   npm run stage -- --in out/6091_2019_p2 --paper-id tys2019-p2 --dry-run
 *
 * Copies the extracted figures into data/assets/<paper-id>/, rewrites the
 * Markdown image references to match, and writes staged.md + manifest.json next
 * to the parser output. See tools/parse/README.md for the parser commands.
 */

import path from "node:path";
import { stageParserOutput } from "@/lib/stage";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

const inputDir = arg("in");
const paperId = arg("paper-id");
const dryRun = process.argv.includes("--dry-run");

if (!inputDir || !paperId) {
  console.error("usage: npm run stage -- --in <parser-output-dir> --paper-id <id> [--dry-run]");
  process.exit(1);
}

try {
  const result = stageParserOutput({
    inputDir,
    paperId,
    repoRoot: process.cwd(),
    dryRun,
  });

  console.log(`markdown:  ${path.relative(process.cwd(), result.markdownFile)}`);
  console.log(`figures:   ${result.figures.length} → data/assets/${paperId}/`);
  console.log(`rewrote:   ${result.rewritten} image reference(s)`);
  for (const w of result.warnings) console.log(`warning:   ${w}`);
  console.log(
    dryRun
      ? "\ndry run — nothing written."
      : `\nwrote ${path.join(inputDir, "staged.md")} and ${path.join(inputDir, "manifest.json")}`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
