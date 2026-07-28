/**
 * Normalises externally-supplied question data into `BankEntry` values.
 *
 * The import path is deliberately forgiving about *shape* (field aliases, loose
 * casing, comma-joined tags) and strict about *validity* (topic must exist in
 * the syllabus, MCQs must have exactly one key, templates must expand). Bad
 * rows are reported, not silently dropped or silently accepted.
 */

import type {
  AO,
  BankEntry,
  Difficulty,
  McqOption,
  Question,
  QuestionAsset,
  QuestionFormat,
  QuestionTemplate,
} from "@/lib/types";
import { isValidTopicId } from "@/lib/syllabus";
import { expandTemplate } from "@/lib/template/engine";
import { hasSupportedAssetExtension, normaliseAssetPath } from "@/lib/assets";
import { assetExists } from "@/lib/assets.server";

export interface ImportIssue {
  index: number;
  id?: string;
  message: string;
}

export interface ImportResult {
  entries: BankEntry[];
  issues: ImportIssue[];
}

const FORMATS: QuestionFormat[] = ["mcq", "structured", "data_based", "free_response", "practical"];
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const AOS: AO[] = ["AO1", "AO2", "AO3"];

type Raw = Record<string, unknown>;

function pick(raw: Raw, ...names: string[]): unknown {
  for (const n of names) {
    if (raw[n] !== undefined && raw[n] !== null && raw[n] !== "") return raw[n];
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  return undefined;
}

function asTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = asString(v);
  if (!s) return [];
  return s.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
}

function normaliseTopicId(v: unknown): string | undefined {
  const s = asString(v);
  if (!s) return undefined;
  // Accept "T3", "3", "topic 3", "Topic03".
  const m = /^(?:topic\s*)?T?0*(\d{1,2})$/i.exec(s);
  return m ? `T${Number(m[1])}` : s;
}

function normaliseOptions(v: unknown): McqOption[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const labels = ["A", "B", "C", "D", "E", "F"];
  return v.map((opt, i) => {
    if (typeof opt === "string") {
      // "A) 5 m/s *" — a trailing asterisk marks the key in many exported banks.
      const correct = /\*\s*$/.test(opt);
      const text = opt.replace(/\*\s*$/, "").replace(/^\s*[A-Fa-f][)accent.]\s*/, "").trim();
      return { label: labels[i] ?? String(i + 1), text, correct };
    }
    const o = opt as Raw;
    return {
      label: asString(pick(o, "label", "key")) ?? labels[i] ?? String(i + 1),
      text: asString(pick(o, "text", "option", "value")) ?? "",
      correct: pick(o, "correct", "isCorrect", "is_correct") === true,
    };
  });
}

/**
 * Parse and validate the `assets` field.
 *
 * A question whose figure path is wrong is unusable — you would only find out
 * when a student is looking at a blank space — so a bad path is a rejection,
 * not a warning. `checkFiles: false` skips the on-disk check for the case where
 * the JSON lands before the images are copied across.
 */
function normaliseAssets(
  raw: Raw,
  index: number,
  id: string | undefined,
  issues: ImportIssue[],
  checkFiles: boolean,
): QuestionAsset[] | undefined {
  const value = pick(raw, "assets", "figures", "images", "image", "figure");
  if (value === undefined) return undefined;

  const list = Array.isArray(value) ? value : [value];
  const out: QuestionAsset[] = [];

  for (const item of list) {
    const record: Raw = typeof item === "string" ? { path: item } : (item as Raw);
    const rawPath = asString(pick(record, "path", "src", "file", "url", "image"));
    if (!rawPath) {
      issues.push({ index, id, message: "asset entry has no `path`" });
      continue;
    }

    const safe = normaliseAssetPath(rawPath);
    if (!safe) {
      issues.push({
        index,
        id,
        message: `asset path "${rawPath}" is not a safe relative path inside data/assets`,
      });
      continue;
    }
    if (!hasSupportedAssetExtension(safe)) {
      issues.push({ index, id, message: `asset "${safe}" is not a png/jpg/webp/gif/svg` });
      continue;
    }
    if (checkFiles && !assetExists(safe)) {
      issues.push({ index, id, message: `asset "${safe}" was not found under data/assets` });
      continue;
    }

    const width = Number(pick(record, "width", "w"));
    const height = Number(pick(record, "height", "h"));
    out.push({
      path: safe,
      caption: asString(pick(record, "caption", "label", "title")),
      alt: asString(pick(record, "alt", "description", "altText", "alt_text")),
      width: Number.isFinite(width) && width > 0 ? Math.round(width) : undefined,
      height: Number.isFinite(height) && height > 0 ? Math.round(height) : undefined,
    });
  }

  return out.length ? out : undefined;
}

function validateCommon(raw: Raw, index: number, issues: ImportIssue[]) {
  const id = asString(pick(raw, "id", "questionId", "question_id"));
  const topicId = normaliseTopicId(pick(raw, "topicId", "topic_id", "topic"));
  const format = asString(pick(raw, "format", "type", "questionType"))?.toLowerCase() as
    | QuestionFormat
    | undefined;
  const difficulty = asString(pick(raw, "difficulty", "level"))?.toLowerCase() as
    | Difficulty
    | undefined;
  const aoRaw = asString(pick(raw, "ao", "assessmentObjective"))?.toUpperCase();
  const marksRaw = pick(raw, "marks", "mark", "points");

  if (!id) issues.push({ index, message: "missing `id`" });
  if (!topicId) {
    issues.push({ index, id, message: "missing `topicId`" });
  } else if (!isValidTopicId(topicId)) {
    issues.push({ index, id, message: `topic "${topicId}" is not in the 6091 syllabus` });
  }
  if (!format || !FORMATS.includes(format)) {
    issues.push({ index, id, message: `format must be one of ${FORMATS.join(", ")}` });
  }
  if (difficulty && !DIFFICULTIES.includes(difficulty)) {
    issues.push({ index, id, message: `difficulty must be one of ${DIFFICULTIES.join(", ")}` });
  }
  const ao = (aoRaw && AOS.includes(aoRaw as AO) ? aoRaw : "AO2") as AO;
  const marks = Number(marksRaw);

  return {
    id,
    topicId,
    subtopicId: asString(pick(raw, "subtopicId", "subtopic_id", "subtopic")),
    format,
    difficulty: (difficulty && DIFFICULTIES.includes(difficulty) ? difficulty : "medium") as Difficulty,
    ao,
    marks: Number.isFinite(marks) && marks > 0 ? Math.round(marks) : 1,
    tags: asTags(pick(raw, "tags", "tag", "labels")),
    source: asString(pick(raw, "source")) ?? "import",
    createdAt: asString(pick(raw, "createdAt", "created_at")) ?? new Date().toISOString(),
  };
}

function parseStatic(
  raw: Raw,
  index: number,
  issues: ImportIssue[],
  opts: ParseOptions,
): Question | undefined {
  const before = issues.length;
  const common = validateCommon(raw, index, issues);
  const stem = asString(pick(raw, "stem", "question", "text", "body"));
  const answer = asString(pick(raw, "answer", "key", "correctAnswer"));
  const options = normaliseOptions(pick(raw, "options", "choices"));
  const assets = normaliseAssets(raw, index, common.id, issues, opts.checkAssetFiles);

  if (!stem) issues.push({ index, id: common.id, message: "missing `stem`" });

  if (common.format === "mcq") {
    if (!options || options.length < 2) {
      issues.push({ index, id: common.id, message: "mcq needs at least 2 options" });
    } else {
      const keys = options.filter((o) => o.correct).length;
      if (keys !== 1) {
        issues.push({
          index,
          id: common.id,
          message: `mcq must have exactly 1 correct option (found ${keys})`,
        });
      }
    }
  } else if (!answer) {
    issues.push({ index, id: common.id, message: "missing `answer`" });
  }

  if (issues.length !== before) return undefined;

  const key = options?.find((o) => o.correct);
  return {
    kind: "static",
    id: common.id!,
    source: common.source,
    topicId: common.topicId!,
    subtopicId: common.subtopicId,
    format: common.format!,
    difficulty: common.difficulty,
    ao: common.ao,
    marks: common.marks,
    stem: stem!,
    options,
    assets,
    answer: answer ?? (key ? `${key.label} (${key.text})` : ""),
    solution: asString(pick(raw, "solution", "workedSolution", "markScheme", "explanation")),
    tags: common.tags,
    createdAt: common.createdAt,
  };
}

function parseTemplate(
  raw: Raw,
  index: number,
  issues: ImportIssue[],
  opts: ParseOptions,
): QuestionTemplate | undefined {
  const before = issues.length;
  const common = validateCommon(raw, index, issues);
  const stem = asString(pick(raw, "stem", "question", "text"));
  const assets = normaliseAssets(raw, index, common.id, issues, opts.checkAssetFiles);
  if (!stem) issues.push({ index, id: common.id, message: "missing `stem`" });

  const variables = raw.variables;
  if (!Array.isArray(variables) || variables.length === 0) {
    issues.push({ index, id: common.id, message: "template needs a non-empty `variables` array" });
  }

  const answer = raw.answer as Raw | undefined;
  if (!answer || !asString(answer.value)) {
    issues.push({ index, id: common.id, message: "template needs `answer.value`" });
  }

  if (issues.length !== before) return undefined;

  const template: QuestionTemplate = {
    kind: "template",
    id: common.id!,
    source: common.source,
    topicId: common.topicId!,
    subtopicId: common.subtopicId,
    format: common.format!,
    difficulty: common.difficulty,
    ao: common.ao,
    marks: common.marks,
    stem: stem!,
    assets,
    variables: variables as QuestionTemplate["variables"],
    constraints: (raw.constraints as string[] | undefined) ?? undefined,
    derived: (raw.derived as QuestionTemplate["derived"]) ?? undefined,
    answer: answer as unknown as QuestionTemplate["answer"],
    solution: asString(pick(raw, "solution", "workedSolution")),
    options: (raw.options as QuestionTemplate["options"]) ?? undefined,
    tags: common.tags,
    createdAt: common.createdAt,
  };

  // A template that cannot produce a single valid variant is worse than no
  // template at all — it fails silently later, at paper-generation time.
  try {
    const probe = expandTemplate(template, { seed: 1, count: 1 });
    if (probe.questions.length === 0) {
      issues.push({
        index,
        id: common.id,
        message: `template does not expand: ${probe.warnings[0] ?? "no variant produced"}`,
      });
      return undefined;
    }
  } catch (err) {
    issues.push({
      index,
      id: common.id,
      message: `template failed to expand: ${err instanceof Error ? err.message : String(err)}`,
    });
    return undefined;
  }

  return template;
}

export interface ParseOptions {
  /**
   * Verify each referenced figure exists under `data/assets`. Turn off when the
   * question JSON arrives before the images have been copied across.
   */
  checkAssetFiles: boolean;
}

const DEFAULT_PARSE_OPTIONS: ParseOptions = { checkAssetFiles: true };

/** Parse an array of raw records into bank entries. */
export function parseEntries(
  records: unknown[],
  options: Partial<ParseOptions> = {},
): ImportResult {
  const opts: ParseOptions = { ...DEFAULT_PARSE_OPTIONS, ...options };
  const entries: BankEntry[] = [];
  const issues: ImportIssue[] = [];
  const seenIds = new Set<string>();

  records.forEach((record, index) => {
    if (typeof record !== "object" || record === null) {
      issues.push({ index, message: "record is not an object" });
      return;
    }
    const raw = record as Raw;
    const kind = asString(pick(raw, "kind")) === "template" || raw.variables ? "template" : "static";
    const entry = kind === "template"
      ? parseTemplate(raw, index, issues, opts)
      : parseStatic(raw, index, issues, opts);

    if (!entry) return;
    if (seenIds.has(entry.id)) {
      issues.push({ index, id: entry.id, message: "duplicate id within this import" });
      return;
    }
    seenIds.add(entry.id);
    entries.push(entry);
  });

  return { entries, issues };
}

/** Minimal RFC-4180 CSV reader (handles quoted fields and embedded newlines). */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => { obj[h] = (r[i] ?? "").trim(); });
    return obj;
  });
}

/** Accepts a JSON array, a `{questions: [...]}` wrapper, JSONL, or CSV. */
export function parseImportPayload(
  text: string,
  filename = "",
  options: Partial<ParseOptions> = {},
): ImportResult {
  const trimmed = text.trim();

  if (filename.toLowerCase().endsWith(".csv") || (!trimmed.startsWith("[") && !trimmed.startsWith("{"))) {
    if (filename.toLowerCase().endsWith(".csv") || trimmed.includes(",")) {
      return parseEntries(parseCsv(text), options);
    }
  }

  if (trimmed.startsWith("[")) return parseEntries(JSON.parse(trimmed) as unknown[], options);

  if (trimmed.startsWith("{")) {
    // Either a wrapper object or JSONL (one object per line).
    if (trimmed.includes("}\n{") || trimmed.includes("}\r\n{")) {
      const records = trimmed.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as unknown);
      return parseEntries(records, options);
    }
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    // A wrapper may split static questions and templates across keys; take all
    // of them rather than only the first array we recognise.
    const collected = ["questions", "templates", "entries", "items", "data"]
      .map((key) => obj[key])
      .filter(Array.isArray)
      .flat();
    if (collected.length) return parseEntries(collected, options);
    return parseEntries([obj], options);
  }

  throw new Error("Unrecognised import format — expected JSON array, JSONL, {questions: [...]}, or CSV");
}
