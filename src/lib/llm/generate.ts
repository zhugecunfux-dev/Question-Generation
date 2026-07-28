/**
 * LLM-authored questions: few-shot from the existing bank, constrained by the
 * syllabus, returned as validated JSON.
 *
 * The model never sees a free-text "write some physics questions" prompt — it
 * gets the exact topic + sub-topic list it is allowed to draw on, real exemplar
 * questions from the bank in the same format, and a JSON schema for the output.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AO, Difficulty, Question, QuestionFormat } from "@/lib/types";
import { findTopic, getSyllabus } from "@/lib/syllabus";
import { getStaticQuestions } from "@/lib/db";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

export class LlmUnavailableError extends Error {}
export class LlmRefusalError extends Error {}

const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topicId: { type: "string" },
          subtopicId: { type: "string" },
          format: { type: "string", enum: ["mcq", "structured", "data_based", "free_response"] },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          ao: { type: "string", enum: ["AO1", "AO2"] },
          marks: { type: "integer" },
          stem: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                text: { type: "string" },
                correct: { type: "boolean" },
              },
              required: ["label", "text", "correct"],
              additionalProperties: false,
            },
          },
          answer: { type: "string" },
          solution: { type: "string" },
        },
        required: ["topicId", "format", "difficulty", "ao", "marks", "stem", "answer", "solution"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

interface ModelQuestion {
  topicId: string;
  subtopicId?: string;
  format: QuestionFormat;
  difficulty: Difficulty;
  ao: AO;
  marks: number;
  stem: string;
  options?: Array<{ label: string; text: string; correct: boolean }>;
  answer: string;
  solution: string;
}

function buildSystemPrompt(): string {
  const syllabus = getSyllabus();
  const paper1 = syllabus.papers.find((p) => p.id === "paper1");
  const paper2 = syllabus.papers.find((p) => p.id === "paper2");

  return [
    `You write exam questions for the Singapore-Cambridge GCE Ordinary Level Physics syllabus ${syllabus.subjectCode} (${syllabus.syllabusYear}).`,
    "",
    "House rules:",
    `- Paper 1 is ${paper1?.structure[0].questionCount ?? 40} four-option MCQs (1 mark each). Paper 2 Section A is structured questions; Section B is free response.`,
    "- Use SI units and the symbols in the syllabus. Take g = 9.81 N/kg unless the question states otherwise.",
    "- Quote numerical answers to 2 or 3 significant figures, and always give the unit.",
    "- AO1 questions test recall and understanding; AO2 questions test applying physics to an unfamiliar situation. Do not write AO3 (practical) questions — those are Paper 3 and need real apparatus.",
    "- Every question must be answerable from the stem alone. Do not reference a figure, graph, diagram, or table unless you fully describe its contents in words inside the stem.",
    "- Stay inside the listed sub-topics. The 2024 revision removed the standalone Temperature topic, the quantitative gas laws, and vernier/micrometer reading — never test those.",
    "- For MCQ, write exactly four options labelled A-D with exactly one correct. Distractors must come from plausible student errors (wrong formula rearrangement, unit slip, sign error), not from absurd magnitudes.",
    "- `solution` is the mark scheme: state the physics principle, the working, and the final answer.",
    "",
    "Return only the JSON object matching the schema. Do not repeat an exemplar question — the exemplars show the house style and difficulty calibration, not content to copy.",
  ].join("\n");
}

function buildUserPrompt(opts: {
  topicIds: string[];
  formats: QuestionFormat[];
  difficulties: Difficulty[];
  count: number;
  notes?: string;
  exemplars: Question[];
}): string {
  const topicLines = opts.topicIds.map((id) => {
    const topic = findTopic(id);
    if (!topic) return `- ${id} (unknown topic)`;
    const subs = topic.subtopics.map((s) => `    - ${s.id}: ${s.title}`).join("\n");
    const note = topic.syllabusNote ? `\n    NOTE: ${topic.syllabusNote}` : "";
    return `- ${topic.id}: ${topic.title}${note}\n${subs}`;
  });

  const exemplarBlock = opts.exemplars.length
    ? opts.exemplars
        .map((q, i) => {
          const options = q.options
            ? "\n" + q.options.map((o) => `  ${o.label}. ${o.text}${o.correct ? "   <- key" : ""}`).join("\n")
            : "";
          return [
            `Exemplar ${i + 1} — ${q.topicId}, ${q.format}, ${q.difficulty}, ${q.ao}, ${q.marks} mark(s)`,
            q.stem + options,
            `Answer: ${q.answer}`,
            q.solution ? `Mark scheme: ${q.solution}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n")
    : "(The bank has no questions on these topics yet — follow the house rules and calibrate to O-Level standard.)";

  return [
    `Write ${opts.count} new question(s).`,
    "",
    "Allowed topics and sub-topics:",
    topicLines.join("\n"),
    "",
    `Allowed formats: ${opts.formats.join(", ")}`,
    `Target difficulty mix: ${opts.difficulties.join(", ")}`,
    opts.notes ? `\nAdditional instruction from the teacher: ${opts.notes}` : "",
    "",
    "Exemplars from the existing bank (house style reference):",
    exemplarBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Reject anything the model produced that would not survive the import path. */
function validate(q: ModelQuestion, allowedTopics: string[]): string | undefined {
  if (!allowedTopics.includes(q.topicId)) return `topic ${q.topicId} was not requested`;
  if (!q.stem.trim()) return "empty stem";
  if (!q.answer.trim()) return "empty answer";
  if (q.marks < 1 || q.marks > 12) return `implausible mark allocation (${q.marks})`;
  if (q.format === "mcq") {
    if (!q.options || q.options.length !== 4) return "mcq must have exactly 4 options";
    const keys = q.options.filter((o) => o.correct).length;
    if (keys !== 1) return `mcq must have exactly 1 key (found ${keys})`;
    if (q.marks !== 1) return "mcq must be worth 1 mark";
  } else if (q.options?.length) {
    return "non-mcq question must not carry options";
  }
  // A stem that promises a figure it cannot supply is unusable on paper.
  if (/\b(fig(?:ure)?|diagram|graph shown|table below|shown below)\b/i.test(q.stem) &&
      !/describ|as follows|the values are|consists of/i.test(q.stem)) {
    return "stem references a figure/diagram that is not described in words";
  }
  return undefined;
}

export interface LlmGenerateOptions {
  topicIds: string[];
  formats: QuestionFormat[];
  difficulties: Difficulty[];
  count: number;
  notes?: string;
}

export async function generateWithLlm(
  opts: LlmGenerateOptions,
): Promise<{ questions: Question[]; warnings: string[] }> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new LlmUnavailableError(
      "ANTHROPIC_API_KEY is not set. Set it in .env.local, or use retrieve/template mode.",
    );
  }

  const client = new Anthropic();

  // Few-shot on real bank questions in the same topics + formats.
  const exemplars = getStaticQuestions({
    topicIds: opts.topicIds,
    formats: opts.formats,
    limit: 6,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: buildSystemPrompt(),
    output_config: { format: { type: "json_schema", schema: QUESTION_SCHEMA } },
    messages: [{ role: "user", content: buildUserPrompt({ ...opts, exemplars }) }],
  });

  if (response.stop_reason === "refusal") {
    throw new LlmRefusalError(
      `The model declined this request${
        response.stop_details ? ` (${response.stop_details.category ?? "unspecified"})` : ""
      }.`,
    );
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content.");
  }

  let parsed: { questions: ModelQuestion[] };
  try {
    parsed = JSON.parse(textBlock.text) as { questions: ModelQuestion[] };
  } catch {
    throw new Error("Model returned text that was not valid JSON.");
  }

  const warnings: string[] = [];
  if (response.stop_reason === "max_tokens") {
    warnings.push("Model hit the output token limit — the last question may be missing.");
  }

  const questions: Question[] = [];
  const stamp = Date.now().toString(36);

  parsed.questions.forEach((q, i) => {
    const problem = validate(q, opts.topicIds);
    if (problem) {
      warnings.push(`Discarded model question ${i + 1}: ${problem}`);
      return;
    }
    questions.push({
      kind: "static",
      id: `llm-${stamp}-${i + 1}`,
      source: `llm:${MODEL}`,
      topicId: q.topicId,
      subtopicId: q.subtopicId,
      format: q.format,
      difficulty: q.difficulty,
      ao: q.ao,
      marks: q.marks,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      solution: q.solution,
      tags: ["generated:llm", "needs-review"],
      createdAt: new Date().toISOString(),
    });
  });

  if (questions.length < opts.count) {
    warnings.push(
      `Asked for ${opts.count} question(s), kept ${questions.length} after validation.`,
    );
  }

  return { questions, warnings };
}
