/**
 * Measures what a source document actually costs as tokens, three ways:
 *
 *   1. as a PDF document block  — Claude extracts the text AND renders each
 *      page to an image, so you pay for both
 *   2. as extracted plain text / Markdown
 *   3. as your final structured JSON question records
 *
 * Estimates are worth little here — page density varies enormously between a
 * text-heavy Paper 2 and a diagram-heavy Paper 1. Run this on your own papers.
 *
 *   npm run token-cost -- source/6091_2019_p1.pdf
 *   npm run token-cost -- source/6091_2019_p1.pdf parsed/6091_2019_p1.md
 *   npm run token-cost -- --model claude-sonnet-5 source/*.pdf
 */

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

// Input price per million tokens, for the cost column only.
const INPUT_PRICE: Record<string, number> = {
  "claude-opus-5": 5,
  "claude-opus-4-8": 5,
  "claude-sonnet-5": 3,
  "claude-haiku-4-5": 1,
};

const args = process.argv.slice(2);
const modelFlag = args.indexOf("--model");
const model = modelFlag >= 0 ? args[modelFlag + 1] : "claude-opus-5";
// Guard the -1 case: without --model, `modelFlag + 1` is 0 and would silently
// swallow the first filename.
const modelValueIndex = modelFlag >= 0 ? modelFlag + 1 : -1;
const files = args.filter((a, i) => !a.startsWith("--") && i !== modelValueIndex);

if (files.length === 0) {
  console.error("usage: npm run token-cost -- [--model <id>] <file.pdf|file.md> ...");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error("ANTHROPIC_API_KEY is not set — token counting needs the API.");
  process.exit(1);
}

const client = new Anthropic();

const price = INPUT_PRICE[model];
const usd = (tokens: number) =>
  price === undefined ? "—" : "$" + ((tokens / 1e6) * price).toFixed(4);

async function countPdf(file: string): Promise<number> {
  const data = fs.readFileSync(file).toString("base64");
  const res = await client.messages.countTokens({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
          { type: "text", text: "." },
        ],
      },
    ],
  });
  return res.input_tokens;
}

async function countText(text: string): Promise<number> {
  const res = await client.messages.countTokens({
    model,
    messages: [{ role: "user", content: text }],
  });
  return res.input_tokens;
}

const rows: Array<{ file: string; kind: string; tokens: number; note: string }> = [];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`skipped ${file}: not found`);
    continue;
  }
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === ".pdf") {
      const tokens = await countPdf(file);
      rows.push({ file, kind: "pdf (text + page images)", tokens, note: "" });
    } else {
      const text = fs.readFileSync(file, "utf8");
      const tokens = await countText(text);
      const kind = ext === ".json" ? "json (structured)" : "text / markdown";
      rows.push({ file, kind, tokens, note: "" });
    }
  } catch (err) {
    console.error(`failed on ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (rows.length === 0) process.exit(1);

const w = Math.max(...rows.map((r) => r.file.length), 4);
console.log(`\nmodel: ${model}${price ? `  ($${price}/MTok input)` : ""}\n`);
console.log(
  "file".padEnd(w) + "  " + "form".padEnd(26) + "  " +
  "tokens".padStart(9) + "  " + "cost/pass".padStart(10),
);
console.log("-".repeat(w + 2 + 26 + 2 + 9 + 2 + 10));
for (const r of rows) {
  console.log(
    r.file.padEnd(w) + "  " + r.kind.padEnd(26) + "  " +
    r.tokens.toLocaleString().padStart(9) + "  " + usd(r.tokens).padStart(10),
  );
}

const pdf = rows.filter((r) => r.kind.startsWith("pdf"));
const flat = rows.filter((r) => !r.kind.startsWith("pdf"));
if (pdf.length && flat.length) {
  const p = pdf.reduce((s, r) => s + r.tokens, 0);
  const f = flat.reduce((s, r) => s + r.tokens, 0);
  console.log(
    `\nPDF form is ${(p / f).toFixed(1)}x the tokens of the extracted form ` +
      `(${p.toLocaleString()} vs ${f.toLocaleString()}).`,
  );
}

console.log(
  "\nRemember this is a per-pass cost at ingestion only. Once questions are in\n" +
    "the bank, generating papers never touches the source document again.\n",
);
