/**
 * Fills in `alt` for bank figures that don't have one, using Claude vision.
 *
 * The description is metadata — it makes figures searchable, gives the model
 * context when few-shotting, and is the accessibility text. It is NOT a
 * replacement for the image: the image stays the source of truth, and a
 * question is never answered from the description alone.
 *
 *   npm run describe-assets -- --dry-run
 *   npm run describe-assets
 *   npm run describe-assets -- --force        # redo ones that already have alt
 */

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { queryEntries, upsertEntries } from "@/lib/db";
import { resolveAssetPath } from "@/lib/assets.server";
import type { BankEntry } from "@/lib/types";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error("ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

const MEDIA: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const SYSTEM = [
  "You describe figures from Singapore O-Level Physics (6091) exam papers.",
  "",
  "Write one paragraph, plain text, no markdown. Record every quantity a student",
  "would need to read off the figure: axis labels with units and ranges, the shape",
  "and key coordinates of any trace, component values and how components are",
  "connected, labelled angles and distances, and the direction of any arrow.",
  "",
  "Describe only what is drawn. Do not solve the question, do not state what the",
  "figure demonstrates, and do not add physics the figure does not show. Prefer",
  "'velocity rises linearly from 0 to 20 m/s over 5 s' to 'the trolley accelerates'.",
].join("\n");

const client = new Anthropic();

interface Pending {
  entry: BankEntry;
  assetIndex: number;
  absolutePath: string;
  relativePath: string;
}

const entries = queryEntries({ limit: 500 });
const pending: Pending[] = [];

for (const entry of entries) {
  entry.assets?.forEach((asset, assetIndex) => {
    if (asset.alt && !force) return;
    const absolutePath = resolveAssetPath(asset.path);
    if (!absolutePath || !fs.existsSync(absolutePath)) {
      console.error(`! ${entry.id}: asset "${asset.path}" is missing on disk — skipped`);
      return;
    }
    pending.push({ entry, assetIndex, absolutePath, relativePath: asset.path });
  });
}

if (pending.length === 0) {
  console.log("Nothing to do — every figure already has a description.");
  process.exit(0);
}

console.log(`${pending.length} figure(s) to describe${dryRun ? " (dry run)" : ""}.\n`);

/** SVGs aren't a vision input type; rasterising them needs a renderer we don't ship. */
function imageBlock(absolutePath: string) {
  const ext = path.extname(absolutePath).toLowerCase();
  const media = MEDIA[ext];
  if (!media) return null;
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: media,
      data: fs.readFileSync(absolutePath).toString("base64"),
    },
  };
}

const touched = new Map<string, BankEntry>();
let described = 0;
let skipped = 0;

for (const item of pending) {
  const block = imageBlock(item.absolutePath);
  if (!block) {
    console.log(`skip  ${item.relativePath} (${path.extname(item.relativePath)} is not a vision input type)`);
    skipped++;
    continue;
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            block,
            {
              type: "text",
              text:
                `This figure belongs to a ${item.entry.topicId} question. ` +
                `The question stem is:\n\n${item.entry.stem}\n\nDescribe the figure.`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      console.log(`skip  ${item.relativePath} (model declined)`);
      skipped++;
      continue;
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text" || !text.text.trim()) {
      console.log(`skip  ${item.relativePath} (empty response)`);
      skipped++;
      continue;
    }

    const alt = text.text.trim().replace(/\s+/g, " ");
    const entry = touched.get(item.entry.id) ?? structuredClone(item.entry);
    entry.assets![item.assetIndex].alt = alt;
    touched.set(entry.id, entry);
    described++;

    console.log(`ok    ${item.relativePath}`);
    console.log(`      ${alt.slice(0, 150)}${alt.length > 150 ? "…" : ""}`);
  } catch (err) {
    console.error(`fail  ${item.relativePath}: ${err instanceof Error ? err.message : String(err)}`);
    skipped++;
  }
}

if (!dryRun && touched.size > 0) {
  upsertEntries([...touched.values()]);
}

console.log(
  `\n${described} described, ${skipped} skipped` +
    (dryRun ? " (dry run — nothing written)." : `, ${touched.size} bank entr(ies) updated.`),
);
