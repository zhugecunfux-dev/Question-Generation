/**
 * Import one MinerU OCR directory into the private, topic-classified knowledge base.
 *
 * Example:
 *   npm run knowledge:import -- \
 *     --in "../notes/mineru-output/Kinematics/ocr" \
 *     --topic-id T2 \
 *     --id kinematics-notes \
 *     --title "Kinematics Notes" \
 *     --kind notes
 *
 * The importer copies one Markdown file, every top-level JSON sidecar, and the
 * images directory. Parser-generated PDFs and all other files are excluded.
 */

import { importKnowledgeBundle } from "@/lib/knowledge.server";
import type { KnowledgeSourceKind } from "@/lib/types";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

const inputDir = argument("in");
const topicId = argument("topic-id");
const id = argument("id");
const title = argument("title");
const kind = argument("kind");

if (!inputDir || !topicId || !id || !title || !kind) {
  console.error(
    "usage: npm run knowledge:import -- " +
      "--in <mineru-ocr-dir> --topic-id <T1-T20> --id <slug> " +
      '--title "<display name>" --kind <notes|exercise|reference>',
  );
  process.exit(1);
}

if (!["notes", "exercise", "reference"].includes(kind)) {
  console.error(`invalid --kind "${kind}"; use notes, exercise, or reference`);
  process.exit(1);
}

try {
  const result = importKnowledgeBundle({
    inputDir,
    topicId,
    id,
    title,
    kind: kind as KnowledgeSourceKind,
  });
  const source = result.source;
  console.log(`status:    ${result.status}`);
  console.log(`source:    ${source.id}`);
  console.log(`topic:     ${source.topicId}`);
  console.log(`kind:      ${source.kind}`);
  console.log(`markdown:  ${source.counts.markdown}`);
  console.log(`json:      ${source.counts.json}`);
  console.log(`images:    ${source.counts.image}`);
  console.log(`bytes:     ${source.totalBytes}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
