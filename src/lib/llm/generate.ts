/**
 * Codex-authored questions: few-shot from the local question bank, constrained
 * by the syllabus, generated through the same local Codex app-server used by
 * /agent, and returned as validated JSON.
 *
 * No Platform or model-provider API key is used here. The user signs in once
 * with `codex login`, and every generation runs in a visible Codex thread.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AO, Difficulty, Question, QuestionFormat } from "@/lib/types";
import { findTopic, getSyllabus } from "@/lib/syllabus";
import { getStaticQuestions } from "@/lib/db";
import { getCodexClient } from "@/lib/codex/client.server";
import type { CodexStreamEvent } from "@/lib/codex/types";
import { reportGenerationProgress } from "@/lib/generation-progress.server";

const CODEX_TIMEOUT_MS = 300_000;
const MAX_SVG_CHARS = 200_000;

export class LlmUnavailableError extends Error {}
export class LlmRefusalError extends Error {}

interface ModelFigure {
  caption: string;
  alt: string;
  svgPrompt: string;
  width: number;
  height: number;
  svg: string;
}

export interface ModelQuestion {
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
  figure?: ModelFigure;
}

function buildSystemPrompt(): string {
  const syllabus = getSyllabus();
  const paper1 = syllabus.papers.find((p) => p.id === "paper1");

  return [
    `You write original practice questions for Singapore-Cambridge GCE Ordinary Level Physics ${syllabus.subjectCode} (${syllabus.syllabusYear}).`,
    "Use the supplied local question-bank exemplars as the reference for wording, scope, difficulty, and mark-scheme style. Create new questions; never copy an exemplar or merely change its names and numbers.",
    "",
    "Exam rules:",
    `- Paper 1 uses ${paper1?.structure[0].questionCount ?? 40} four-option MCQs worth 1 mark each.`,
    "- Use SI units and syllabus notation. Take g = 9.81 N/kg unless stated otherwise.",
    "- Numerical answers need units and 2 or 3 significant figures.",
    "- AO1 tests recall/understanding; AO2 applies physics in a context. Do not write AO3 practical questions.",
    "- Stay inside the supplied topic and sub-topic list.",
    "- MCQs must have exactly four options A-D and one key. Distractors should reflect plausible student errors.",
    "- `solution` is a complete mark scheme with the principle, working, and final answer.",
    "",
    "Figure rules:",
    "- At least the stated minimum number of questions MUST include `figure`; more are allowed.",
    "- A figure question must explicitly refer to its figure in the stem.",
    "- `svgPrompt` is a detailed production brief for the SVG. Describe canvas size, layout, every object and line, coordinates or relative positions, labels and values, arrow directions, axes/scales, colours, stroke widths, font treatment, and which details must remain visually unambiguous. It must be detailed enough for another illustrator to reproduce the diagram without reading the question.",
    "- `svg` is the finished self-contained SVG matching `svgPrompt`. Use a white background, black/dark strokes, legible text, and a viewBox. Do not use scripts, event handlers, style elements, foreignObject, embedded images, external references, data URLs, CSS url(), or animation.",
    "- Put all information needed to solve the question either in the stem or visibly in the SVG. The `alt` text must precisely describe the drawn information for accessibility, without revealing the answer.",
    "",
    "Output rules:",
    "- Return one JSON object only, with the exact shape shown in the request. No Markdown fences, commentary, tool calls, or file edits.",
    "- Check every answer and SVG against its question before returning.",
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
  const minimumFigures = Math.ceil(opts.count * 0.3);
  const topicLines = opts.topicIds.map((id) => {
    const topic = findTopic(id);
    if (!topic) return `- ${id} (unknown topic)`;
    const subs = topic.subtopics.map((s) => `  - ${s.id}: ${s.title}`).join("\n");
    const note = topic.syllabusNote ? `\n  NOTE: ${topic.syllabusNote}` : "";
    return `- ${topic.id}: ${topic.title}${note}\n${subs}`;
  });

  const exemplarBlock = opts.exemplars.length
    ? opts.exemplars
        .map((q, i) => {
          const options = q.options
            ? "\n" + q.options.map((o) => `  ${o.label}. ${o.text}${o.correct ? " <- key" : ""}`).join("\n")
            : "";
          const figures = q.assets?.length
            ? "\n" +
              q.assets
                .map((a) => `  [Existing figure: ${a.alt ?? a.caption ?? "description unavailable"}]`)
                .join("\n")
            : "";
          return [
            `Exemplar ${i + 1} — ${q.topicId}, ${q.format}, ${q.difficulty}, ${q.ao}, ${q.marks} mark(s)`,
            q.stem + figures + options,
            `Answer: ${q.answer}`,
            q.solution ? `Mark scheme: ${q.solution}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n")
    : "(No matching exemplar exists yet. Follow the syllabus and exam rules.)";

  return [
    `Generate exactly ${opts.count} new questions. At least ${minimumFigures} of them must contain a figure (30%, rounded up).`,
    "",
    "Allowed topics and sub-topics:",
    topicLines.join("\n"),
    "",
    `Allowed formats: ${opts.formats.join(", ")}`,
    `Target difficulty choices: ${opts.difficulties.join(", ")}`,
    opts.notes ? `Teacher instruction: ${opts.notes}` : "",
    "",
    "Local question-bank exemplars:",
    exemplarBlock,
    "",
    "Return exactly this JSON shape:",
    JSON.stringify(
      {
        questions: [
          {
            topicId: "T2",
            subtopicId: "T2.1",
            format: "structured",
            difficulty: "medium",
            ao: "AO2",
            marks: 3,
            stem: "Question text referring to Fig. 1 when figure is present.",
            options: [{ label: "A", text: "MCQ only", correct: true }],
            answer: "Final answer",
            solution: "Worked mark scheme",
            figure: {
              caption: "Fig. 1",
              alt: "Precise accessible description without the answer",
              svgPrompt: "Detailed SVG production brief as required above",
              width: 640,
              height: 420,
              svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 640 420\" width=\"640\" height=\"420\">...</svg>",
            },
          },
        ],
      },
      null,
      2,
    ),
    "",
    "Omit `options` for non-MCQ questions. Omit `figure` only for text-only questions.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseCodexJson(text: string): { questions: ModelQuestion[] } {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Codex did not return a JSON object.");
  }
  let value: unknown;
  try {
    value = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new Error("Codex returned text that was not valid JSON.");
  }
  if (!value || typeof value !== "object" || !Array.isArray((value as { questions?: unknown }).questions)) {
    throw new Error("Codex JSON must contain a `questions` array.");
  }
  return value as { questions: ModelQuestion[] };
}

function validateSvg(svg: string): string | undefined {
  if (typeof svg !== "string") return "figure SVG must be a string";
  if (!svg.trim().startsWith("<svg") || !svg.trim().endsWith("</svg>")) {
    return "figure SVG must be a complete <svg> document";
  }
  if (svg.length > MAX_SVG_CHARS) return "figure SVG is too large";
  const unsafe =
    /<!doctype|<!entity|<script|<style|<foreignObject|<image|<animate|<set\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:|javascript:)|url\s*\(/i;
  if (unsafe.test(svg)) return "figure SVG contains unsafe or external content";
  if (!/\bviewBox\s*=/i.test(svg)) return "figure SVG must include a viewBox";
  return undefined;
}

/** Reject output that would not survive the bank/import path. */
export function validateModelQuestion(q: ModelQuestion, allowedTopics: string[]): string | undefined {
  if (!q || typeof q !== "object") return "question is not an object";
  if (!allowedTopics.includes(q.topicId)) return `topic ${q.topicId} was not requested`;
  if (!["mcq", "structured", "data_based", "free_response"].includes(q.format)) {
    return `unsupported format (${q.format})`;
  }
  if (!["easy", "medium", "hard"].includes(q.difficulty)) {
    return `unsupported difficulty (${q.difficulty})`;
  }
  if (!["AO1", "AO2"].includes(q.ao)) return `unsupported assessment objective (${q.ao})`;
  if (typeof q.stem !== "string" || !q.stem.trim()) return "empty stem";
  if (typeof q.answer !== "string" || !q.answer.trim()) return "empty answer";
  if (typeof q.solution !== "string" || !q.solution.trim()) return "empty solution";
  if (!Number.isInteger(q.marks) || q.marks < 1 || q.marks > 12) {
    return `implausible mark allocation (${q.marks})`;
  }
  if (q.format === "mcq") {
    if (!q.options || q.options.length !== 4) return "mcq must have exactly 4 options";
    if (
      q.options.some(
        (option, index) =>
          option.label !== ["A", "B", "C", "D"][index] ||
          typeof option.text !== "string" ||
          !option.text.trim() ||
          typeof option.correct !== "boolean",
      )
    ) {
      return "mcq options must be labelled A-D in order with non-empty text and boolean keys";
    }
    if (q.options.filter((o) => o.correct).length !== 1) return "mcq must have exactly 1 key";
    if (q.marks !== 1) return "mcq must be worth 1 mark";
  } else if (q.options?.length) {
    return "non-mcq question must not carry options";
  }
  if (q.figure) {
    if (typeof q.figure.caption !== "string" || !q.figure.caption.trim()) {
      return "figure caption is required";
    }
    if (typeof q.figure.alt !== "string" || q.figure.alt.trim().length < 40) {
      return "figure alt text is not detailed enough";
    }
    if (typeof q.figure.svgPrompt !== "string" || q.figure.svgPrompt.trim().length < 120) {
      return "figure svgPrompt is not detailed enough";
    }
    if (
      !Number.isInteger(q.figure.width) ||
      !Number.isInteger(q.figure.height) ||
      q.figure.width < 200 ||
      q.figure.height < 150 ||
      q.figure.width > 1600 ||
      q.figure.height > 1600
    ) {
      return "figure dimensions must be integer pixels between 200×150 and 1600×1600";
    }
    const svgProblem = validateSvg(q.figure.svg);
    if (svgProblem) return svgProblem;
    if (!/\b(fig\.?|figure|diagram|graph|circuit|apparatus)\b/i.test(q.stem)) {
      return "figure question stem does not refer to its figure";
    }
  }
  return undefined;
}

async function runCodex(prompt: string, requestedThreadId?: string): Promise<{ text: string; threadId: string }> {
  const client = getCodexClient();
  try {
    await client.ensureReady();
  } catch (cause) {
    throw new LlmUnavailableError(
      `Codex is unavailable. Run \`npm run codex:login\` locally first. ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }

  const thread = requestedThreadId
    ? await client.resumeThread(requestedThreadId)
    : await client.startThread();
  const threadId = thread.thread.id;
  reportGenerationProgress(threadId, {
    status: "running",
    stage: "request_sent",
    headline: "Codex received the brief",
    detail: "The local Codex turn is starting with the syllabus and bank context.",
    percent: 24,
    event: {
      id: "codex_draft",
      phase: "questions",
      title: "Draft questions and diagrams",
      detail: "Sending the generation brief to local Codex",
      status: "active",
    },
  });
  let finalText = "";
  let activeTurnId = "";
  let workingReported = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  const terminal = new Promise<string>((resolve, reject) => {
    const finish = (error?: Error) => {
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      if (error) reject(error);
      else if (!finalText.trim()) reject(new Error("Codex completed without a final answer."));
      else resolve(finalText);
    };
    unsubscribe = client.subscribe(({ normalized }: { normalized: CodexStreamEvent }) => {
      if (!("threadId" in normalized) || normalized.threadId !== threadId) return;
      if ("turnId" in normalized && activeTurnId && normalized.turnId !== activeTurnId) return;
      if (
        !workingReported &&
        (normalized.type === "message_delta" || normalized.type === "activity")
      ) {
        workingReported = true;
        reportGenerationProgress(threadId, {
          status: "running",
          stage: "codex_writing",
          headline: "Writing questions",
          detail: "Codex is composing stems, distractors, answers, mark schemes, and SVG briefs.",
          percent: 45,
          event: {
            id: "codex_draft",
            phase: "questions",
            title: "Draft questions and diagrams",
            detail: "Composing the requested question set",
            status: "active",
          },
        });
      }
      if (normalized.type === "message" && normalized.text.trim()) {
        finalText = normalized.text;
        reportGenerationProgress(threadId, {
          status: "running",
          stage: "draft_received",
          headline: "Draft received",
          detail: "Codex returned the complete structured draft; validation is next.",
          percent: 66,
          event: {
            id: "codex_draft",
            phase: "questions",
            title: "Draft questions and diagrams",
            detail: "Structured draft returned by Codex",
            status: "done",
          },
        });
      } else if (normalized.type === "completed") {
        finish();
      } else if (normalized.type === "error" && normalized.terminal) {
        finish(new Error(normalized.message));
      }
    });
    timer = setTimeout(() => {
      if (activeTurnId) void client.interruptTurn(threadId, activeTurnId).catch(() => undefined);
      finish(new Error("Codex question generation timed out after 5 minutes."));
    }, CODEX_TIMEOUT_MS);
  });

  try {
    const turn = await client.startTurn(threadId, `${buildSystemPrompt()}\n\n${prompt}`);
    activeTurnId = turn.turn.id;
    reportGenerationProgress(threadId, {
      status: "running",
      stage: "codex_started",
      headline: "Codex is planning the set",
      detail: "Balancing topics, difficulty, distractors, and the required SVG figure ratio.",
      percent: 34,
      event: {
        id: "codex_draft",
        phase: "questions",
        title: "Draft questions and diagrams",
        detail: "Codex turn started",
        status: "active",
      },
    });
    return { text: await terminal, threadId };
  } catch (cause) {
    if (timer) clearTimeout(timer);
    unsubscribe?.();
    throw cause;
  }
}

function assetsRoot(): string {
  return process.env.QG_ASSETS_DIR
    ? path.resolve(process.env.QG_ASSETS_DIR)
    : path.join(process.cwd(), "data", "assets");
}

export interface LlmGenerateOptions {
  topicIds: string[];
  formats: QuestionFormat[];
  difficulties: Difficulty[];
  count: number;
  notes?: string;
  codexThreadId?: string;
}

export async function generateWithLlm(
  opts: LlmGenerateOptions,
): Promise<{ questions: Question[]; warnings: string[]; codexThreadId: string }> {
  // Read a larger local sample than the former API implementation. Filtering
  // keeps the prompt relevant; the fixed limit prevents an unbounded context.
  const exemplars = getStaticQuestions({
    topicIds: opts.topicIds,
    formats: opts.formats,
    limit: 30,
  });
  if (opts.codexThreadId) {
    reportGenerationProgress(opts.codexThreadId, {
      status: "running",
      stage: "bank_context",
      headline: "Reading the question bank",
      detail: exemplars.length
        ? `Selected ${exemplars.length} matching bank question(s) as style and difficulty references.`
        : "No exact topic-and-format match was found; Codex will follow the syllabus rules.",
      percent: 14,
      exemplarCount: exemplars.length,
      event: {
        id: "bank_context",
        phase: "questions",
        title: "Read matching bank questions",
        detail: `${exemplars.length} matching exemplar(s) selected`,
        status: "done",
      },
    });
  }
  const prompt = buildUserPrompt({ ...opts, exemplars });
  const response = await runCodex(prompt, opts.codexThreadId);
  const parsed = parseCodexJson(response.text);
  reportGenerationProgress(response.threadId, {
    status: "running",
    stage: "validating_questions",
    headline: "Checking the question set",
    detail: "Validating topic scope, formats, options, marks, answers, and SVG safety.",
    percent: 72,
    event: {
      id: "validate_questions",
      phase: "questions",
      title: "Validate physics question structure",
      detail: `${parsed.questions.length} returned question(s) under review`,
      status: "active",
    },
  });

  if (parsed.questions.length !== opts.count) {
    throw new Error(`Codex returned ${parsed.questions.length} questions; exactly ${opts.count} were requested.`);
  }

  const problems = parsed.questions
    .map((question, index) => {
      const problem = validateModelQuestion(question, opts.topicIds);
      return problem ? `Question ${index + 1}: ${problem}` : undefined;
    })
    .filter((problem): problem is string => Boolean(problem));
  if (problems.length) {
    throw new Error(`Codex output failed validation: ${problems.join("; ")}`);
  }

  const figureCount = parsed.questions.filter((q) => q.figure).length;
  const minimumFigures = Math.ceil(opts.count * 0.3);
  if (figureCount < minimumFigures) {
    throw new Error(
      `Codex returned ${figureCount} figure question(s); at least ${minimumFigures} are required.`,
    );
  }
  reportGenerationProgress(response.threadId, {
    status: "running",
    stage: "questions_validated",
    headline: "Questions passed validation",
    detail: `${parsed.questions.length} question(s) passed; ${figureCount} include SVG figures.`,
    percent: 80,
    questionCount: parsed.questions.length,
    figureCount,
    event: {
      id: "validate_questions",
      phase: "questions",
      title: "Validate physics question structure",
      detail: `${parsed.questions.length} valid question(s), ${figureCount} figure question(s)`,
      status: "done",
    },
  });

  const stamp = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const generatedDir = path.join(assetsRoot(), "generated", stamp);
  const createdAt = new Date().toISOString();
  reportGenerationProgress(response.threadId, {
    status: "running",
    stage: "layout",
    headline: "Building figures and paper layout",
    detail: "Saving safe SVG assets and assembling the final question order.",
    percent: 86,
    event: {
      id: "layout",
      phase: "layout",
      title: "Save SVGs and assemble paper",
      detail: `${figureCount} SVG figure(s) to place`,
      status: "active",
    },
  });
  const questions = parsed.questions.map((q, index): Question => {
    let assets: Question["assets"];
    if (q.figure) {
      fs.mkdirSync(generatedDir, { recursive: true });
      const filename = `q${index + 1}.svg`;
      fs.writeFileSync(path.join(generatedDir, filename), q.figure.svg, "utf8");
      assets = [
        {
          path: `generated/${stamp}/${filename}`,
          caption: q.figure.caption,
          alt: q.figure.alt,
          width: q.figure.width,
          height: q.figure.height,
          generationPrompt: q.figure.svgPrompt,
        },
      ];
    }
    return {
      kind: "static",
      id: `codex-${stamp}-${index + 1}`,
      source: `codex:${response.threadId}`,
      topicId: q.topicId,
      subtopicId: q.subtopicId,
      format: q.format,
      difficulty: q.difficulty,
      ao: q.ao,
      marks: q.marks,
      stem: q.stem,
      options: q.options,
      assets,
      answer: q.answer,
      solution: q.solution,
      tags: ["generated:codex", "needs-review", ...(q.figure ? ["figure:svg"] : [])],
      createdAt,
    };
  });
  reportGenerationProgress(response.threadId, {
    status: "running",
    stage: "paper_assembled",
    headline: "Paper assembled",
    detail: "Questions, figures, marks, answers, and review tags are ready.",
    percent: 95,
    questionCount: questions.length,
    figureCount,
    event: {
      id: "layout",
      phase: "layout",
      title: "Save SVGs and assemble paper",
      detail: `${questions.length} question(s) placed in the generated paper`,
      status: "done",
    },
  });

  return {
    questions,
    warnings: [
      `Generated in local Codex thread ${response.threadId}; ${figureCount}/${questions.length} questions include SVG figures.`,
      "Codex-authored questions and diagrams are drafts; review physics, wording, answers, and visual accuracy before use.",
    ],
    codexThreadId: response.threadId,
  };
}
