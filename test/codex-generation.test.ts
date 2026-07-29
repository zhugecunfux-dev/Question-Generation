import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseCodexJson,
  validateModelQuestion,
  type ModelQuestion,
} from "@/lib/llm/generate";

const detailedPrompt =
  "Create a 640 by 420 white SVG canvas. Draw black x and y axes from (80,350) to (580,350) and (80,350) to (80,50), with arrowheads, labelled time / s and velocity / m s^-1. Add ticks every 1 s and 5 m s^-1, then a 3 px blue line from (80,350) to (330,100) and horizontally to (580,100). Use 18 px sans-serif labels and keep every coordinate and value legible.";

function question(overrides: Partial<ModelQuestion> = {}): ModelQuestion {
  return {
    topicId: "T2",
    subtopicId: "T2.1",
    format: "structured",
    difficulty: "medium",
    ao: "AO2",
    marks: 3,
    stem: "Fig. 1 shows the velocity-time graph of a trolley. Determine its acceleration.",
    answer: "4.0 m/s²",
    solution: "gradient = Δv/Δt = 20/5 = 4.0 m/s²",
    figure: {
      caption: "Fig. 1",
      alt: "Velocity-time graph rising uniformly from zero to twenty metres per second in five seconds.",
      svgPrompt: detailedPrompt,
      width: 640,
      height: 420,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420"><rect width="640" height="420" fill="white"/><path d="M80 350 L330 100" stroke="black"/></svg>',
    },
    ...overrides,
  };
}

test("Codex JSON parser accepts a fenced object but requires a questions array", () => {
  const parsed = parseCodexJson('```json\n{"questions":[]}\n```');
  assert.deepEqual(parsed, { questions: [] });
  assert.throws(() => parseCodexJson('{"items":[]}'), /questions/);
  assert.throws(() => parseCodexJson("not json"), /JSON object/);
});

test("Codex figure validation requires a detailed prompt and safe self-contained SVG", () => {
  assert.equal(validateModelQuestion(question(), ["T2"]), undefined);
  assert.match(
    validateModelQuestion(
      question({ figure: { ...question().figure!, svgPrompt: "draw a graph" } }),
      ["T2"],
    ) ?? "",
    /svgPrompt/,
  );
  assert.match(
    validateModelQuestion(
      question({
        figure: {
          ...question().figure!,
          svg: '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>',
        },
      }),
      ["T2"],
    ) ?? "",
    /unsafe/,
  );
});

test("MCQ validation still enforces four options, one key, and one mark", () => {
  const mcq = question({
    format: "mcq",
    marks: 1,
    options: [
      { label: "A", text: "1", correct: true },
      { label: "B", text: "2", correct: false },
      { label: "C", text: "3", correct: false },
      { label: "D", text: "4", correct: false },
    ],
  });
  assert.equal(validateModelQuestion(mcq, ["T2"]), undefined);
  assert.match(
    validateModelQuestion({ ...mcq, options: mcq.options?.slice(0, 3) }, ["T2"]) ?? "",
    /exactly 4/,
  );
});
