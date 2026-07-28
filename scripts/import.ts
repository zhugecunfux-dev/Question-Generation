/**
 * CLI importer.
 *
 *   npm run import -- data/questions/seed.json
 *   npm run import -- --dry-run my-export.csv
 */

import fs from "node:fs";
import path from "node:path";
import { parseImportPayload } from "@/lib/import";
import { upsertEntries } from "@/lib/db";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
// Lets the question JSON land before the images are copied across.
const skipAssetCheck = args.includes("--skip-asset-check");
const files = args.filter((a) => !a.startsWith("--"));

if (files.length === 0) {
  console.error("usage: npm run import -- [--dry-run] [--skip-asset-check] <file...>");
  process.exit(1);
}

let totalParsed = 0;
let totalWritten = 0;
let totalRejected = 0;

for (const file of files) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) {
    console.error(`✗ ${file}: not found`);
    process.exitCode = 1;
    continue;
  }

  const text = fs.readFileSync(full, "utf8");
  let result;
  try {
    result = parseImportPayload(text, full, { checkAssetFiles: !skipAssetCheck });
  } catch (err) {
    console.error(`✗ ${file}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    continue;
  }

  const written = dryRun ? 0 : upsertEntries(result.entries);
  totalParsed += result.entries.length;
  totalWritten += written;
  totalRejected += result.issues.length;

  console.log(
    `${result.issues.length === 0 ? "✓" : "!"} ${file}: ${result.entries.length} valid, ` +
      `${result.issues.length} rejected${dryRun ? " (dry run)" : `, ${written} written`}`,
  );
  for (const issue of result.issues.slice(0, 20)) {
    console.log(`    row ${issue.index}${issue.id ? ` (${issue.id})` : ""}: ${issue.message}`);
  }
  if (result.issues.length > 20) {
    console.log(`    …and ${result.issues.length - 20} more`);
  }
}

console.log(
  `\n${totalParsed} valid entr${totalParsed === 1 ? "y" : "ies"}, ` +
    `${totalRejected} rejected, ${totalWritten} written.`,
);
if (totalRejected > 0) process.exitCode = 1;
