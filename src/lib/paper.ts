/**
 * Assembles a paper from the bank: retrieval, template expansion, or LLM.
 */

import type { GenerateRequest, GeneratedPaper, Question, QuestionFormat } from "@/lib/types";
import { getStaticQuestions, getTemplates } from "@/lib/db";
import { makeRng } from "@/lib/template/engine";
import { expandTemplate } from "@/lib/template/engine";
import { generateWithLlm } from "@/lib/llm/generate";
import { topicLabel } from "@/lib/syllabus";

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Spread `count` items as evenly as possible across `buckets`. */
export function allocate(count: number, buckets: number): number[] {
  if (buckets <= 0) return [];
  const base = Math.floor(count / buckets);
  const remainder = count % buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < remainder ? 1 : 0));
}

function retrieve(req: GenerateRequest, seed: number): { questions: Question[]; warnings: string[] } {
  const warnings: string[] = [];
  const rng = makeRng(seed);
  const picked: Question[] = [];
  const quota = allocate(req.count, req.topicIds.length);

  req.topicIds.forEach((topicId, i) => {
    const want = quota[i];
    if (want === 0) return;
    const pool = getStaticQuestions({
      topicIds: [topicId],
      formats: req.formats,
      difficulties: req.difficulties,
      limit: 500,
    });
    const chosen = shuffle(pool, rng).slice(0, want);
    if (chosen.length < want) {
      warnings.push(
        `${topicLabel(topicId)}: wanted ${want} question(s), bank has ${chosen.length} matching the filters.`,
      );
    }
    picked.push(...chosen);
  });

  return { questions: shuffle(picked, rng), warnings };
}

function fromTemplates(
  req: GenerateRequest,
  seed: number,
): { questions: Question[]; warnings: string[] } {
  const warnings: string[] = [];
  const rng = makeRng(seed);
  const picked: Question[] = [];
  const quota = allocate(req.count, req.topicIds.length);

  req.topicIds.forEach((topicId, i) => {
    const want = quota[i];
    if (want === 0) return;

    const templates = getTemplates({
      topicIds: [topicId],
      formats: req.formats,
      difficulties: req.difficulties,
      limit: 200,
    });
    if (templates.length === 0) {
      warnings.push(`${topicLabel(topicId)}: no templates match the filters.`);
      return;
    }

    // Spread the quota across the available templates so a paper doesn't end up
    // as five variants of the same recipe when other recipes exist.
    const perTemplate = allocate(want, templates.length);
    const ordered = shuffle(templates, rng);
    ordered.forEach((template, j) => {
      const n = perTemplate[j];
      if (n === 0) return;
      const result = expandTemplate(template, { seed: seed + j * 7919, count: n });
      picked.push(...result.questions);
      warnings.push(...result.warnings);
    });

    const got = picked.filter((q) => q.topicId === topicId).length;
    if (got < want) {
      warnings.push(`${topicLabel(topicId)}: wanted ${want} variant(s), produced ${got}.`);
    }
  });

  return { questions: shuffle(picked, rng), warnings };
}

export async function generatePaper(req: GenerateRequest): Promise<GeneratedPaper> {
  const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31);

  let result: {
    questions: Question[];
    warnings: string[];
    codexThreadId?: string;
    illustrationThreadId?: string;
  };
  switch (req.mode) {
    case "retrieve":
      result = retrieve(req, seed);
      break;
    case "template":
      result = fromTemplates(req, seed);
      break;
    case "llm":
      result = await generateWithLlm({
        topicIds: req.topicIds,
        formats: (req.formats ?? ["mcq", "structured"]) as QuestionFormat[],
        difficulties: req.difficulties ?? ["easy", "medium", "hard"],
        count: req.count,
        notes: req.notes,
        codexThreadId: req.codexThreadId,
      });
      break;
  }

  return {
    mode: req.mode,
    generatedAt: new Date().toISOString(),
    seed: req.mode === "llm" ? undefined : seed,
    codexThreadId: result.codexThreadId,
    illustrationThreadId: result.illustrationThreadId,
    totalMarks: result.questions.reduce((sum, q) => sum + q.marks, 0),
    questions: result.questions,
    warnings: result.warnings,
  };
}
