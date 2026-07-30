/**
 * Expands a `QuestionTemplate` into concrete `Question`s by sampling its
 * variables, checking constraints, computing derived values, and rendering the
 * stem / solution / options.
 *
 * Sampling is seeded, so the same (template, seed, index) always produces the
 * same question — papers are reproducible and shareable by seed.
 */

import type {
  DerivedSpec,
  McqOption,
  Question,
  QuestionTemplate,
  VariableSpec,
} from "@/lib/types";
import { ExpressionError, evaluateBoolean, evaluateNumber, type Scope } from "./expr";

/** Small, fast, seedable PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TemplateError extends Error {}

function sampleVariable(spec: VariableSpec, rng: () => number): number | string {
  switch (spec.type) {
    case "int": {
      const step = spec.step && spec.step > 0 ? spec.step : 1;
      const steps = Math.floor((spec.max - spec.min) / step);
      if (steps < 0) throw new TemplateError(`variable "${spec.name}": min > max`);
      return spec.min + Math.floor(rng() * (steps + 1)) * step;
    }
    case "float": {
      const decimals = spec.decimals ?? 2;
      const raw = spec.min + rng() * (spec.max - spec.min);
      const f = 10 ** decimals;
      return Math.round(raw * f) / f;
    }
    case "choice": {
      if (spec.values.length === 0) {
        throw new TemplateError(`variable "${spec.name}": empty choice list`);
      }
      return spec.values[Math.floor(rng() * spec.values.length)];
    }
  }
}

function roundForDisplay(value: number, decimals?: number, sigfig?: number): string {
  if (sigfig !== undefined && sigfig > 0) {
    if (value === 0) return "0";
    const rounded = Number(value.toPrecision(sigfig));
    // toPrecision can emit exponent form for large/small magnitudes; keep it,
    // it's the physically correct rendering for e.g. 1.6e-19.
    return Math.abs(rounded) >= 1e-4 && Math.abs(rounded) < 1e7
      ? String(Number(rounded.toPrecision(sigfig)))
      : rounded.toExponential(sigfig - 1);
  }
  if (decimals !== undefined) return value.toFixed(decimals);
  // Default: trim floating-point noise without inventing precision.
  return String(Number(value.toPrecision(12)));
}

/** Replace `{{name}}` placeholders using the rendered scope. */
export function renderTemplate(text: string, rendered: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (whole, name: string) => {
    if (Object.prototype.hasOwnProperty.call(rendered, name)) return rendered[name];
    // Leave unknown placeholders visible rather than silently blanking them —
    // a blank in a physics question is indistinguishable from a real gap.
    return whole;
  });
}

interface Sampled {
  scope: Scope;
  rendered: Record<string, string>;
}

function sampleOnce(
  template: QuestionTemplate,
  rng: () => number,
): Sampled | null {
  const scope: Scope = {};
  for (const spec of template.variables) {
    scope[spec.name] = sampleVariable(spec, rng);
  }

  for (const constraint of template.constraints ?? []) {
    if (!evaluateBoolean(constraint, scope)) return null;
  }

  const rendered: Record<string, string> = {};
  for (const [k, v] of Object.entries(scope)) rendered[k] = String(v);

  for (const d of template.derived ?? []) {
    const value = evaluateNumber(d.expr, scope);
    scope[d.name] = value;
    rendered[d.name] = roundForDisplay(value, d.decimals, d.sigfig);
  }

  return { scope, rendered };
}

function buildOptions(
  template: QuestionTemplate,
  sampled: Sampled,
  rng: () => number,
): McqOption[] | undefined {
  if (!template.options?.length) return undefined;

  const unit = template.answer.unit ? ` ${template.answer.unit}` : "";
  const raw = template.options.map((opt) => {
    const value = evaluateNumber(opt.expr, sampled.scope);
    const shown = roundForDisplay(value, template.answer.decimals, template.answer.sigfig);
    return {
      value,
      text: opt.text
        ? renderTemplate(opt.text, { ...sampled.rendered, __value: shown })
        : `${shown}${unit}`,
      correct: opt.correct === true,
    };
  });

  // Distractors that collide with the key numerically would make the item
  // unanswerable — drop them rather than shipping a broken MCQ.
  const key = raw.find((o) => o.correct);
  if (!key) throw new TemplateError(`template ${template.id}: no option marked correct`);
  const deduped = [key, ...raw.filter((o) => !o.correct && o.text !== key.text)];
  if (deduped.length < 2) return undefined;

  // Fisher-Yates with the seeded rng so option order is reproducible too.
  const shuffled = deduped.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const labels = ["A", "B", "C", "D", "E", "F"];
  return shuffled.map((o, i) => ({ label: labels[i], text: o.text, correct: o.correct }));
}

export interface ExpandOptions {
  seed: number;
  /** How many distinct variants to produce. */
  count: number;
  /** Give up after this many rejected samples per variant. */
  maxAttemptsPerVariant?: number;
}

/**
 * Expand a template into `count` concrete questions.
 *
 * Variants are deduplicated by rendered stem, so a template whose variable
 * space is smaller than `count` yields fewer questions rather than repeats.
 */
export function expandTemplate(
  template: QuestionTemplate,
  { seed, count, maxAttemptsPerVariant = 80 }: ExpandOptions,
): { questions: Question[]; warnings: string[] } {
  const rng = makeRng(seed);
  const questions: Question[] = [];
  const warnings: string[] = [];
  const seenStems = new Set<string>();

  for (let n = 0; n < count; n++) {
    let sampled: Sampled | null = null;
    let attempts = 0;
    let lastError: string | undefined;

    while (attempts < maxAttemptsPerVariant) {
      attempts++;
      try {
        const candidate = sampleOnce(template, rng);
        if (!candidate) continue; // constraint rejected
        const stem = renderTemplate(template.stem, candidate.rendered);
        if (seenStems.has(stem)) continue;
        sampled = candidate;
        break;
      } catch (err) {
        // e.g. a derived expression divided by zero for this draw — resample.
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!sampled) {
      warnings.push(
        `template ${template.id}: could not produce variant ${n + 1} after ` +
          `${maxAttemptsPerVariant} attempts` +
          (lastError ? ` (last error: ${lastError})` : " (constraints too tight or space exhausted)"),
      );
      break;
    }

    const stem = renderTemplate(template.stem, sampled.rendered);
    seenStems.add(stem);

    let answerText: string;
    try {
      const value = evaluateNumber(template.answer.value, sampled.scope);
      const shown = roundForDisplay(value, template.answer.decimals, template.answer.sigfig);
      answerText = template.answer.unit ? `${shown} ${template.answer.unit}` : shown;
    } catch (err) {
      if (err instanceof ExpressionError) {
        // Non-numeric answer key: treat it as a template string.
        answerText = renderTemplate(template.answer.value, sampled.rendered);
      } else {
        throw err;
      }
    }

    const options = buildOptions(template, sampled, rng);

    questions.push({
      kind: "static",
      id: `${template.id}#${seed}-${n + 1}`,
      source: `template:${template.id}`,
      topicId: template.topicId,
      subtopicId: template.subtopicId,
      format: template.format,
      difficulty: template.difficulty,
      ao: template.ao,
      marks: template.marks,
      stem,
      options,
      answer: options ? `${options.find((o) => o.correct)?.label ?? "?"} (${answerText})` : answerText,
      solution: template.solution
        ? renderTemplate(template.solution, sampled.rendered)
        : undefined,
      tags: [...template.tags, "generated:template"],
      createdAt: new Date().toISOString(),
    });
  }

  return { questions, warnings };
}
