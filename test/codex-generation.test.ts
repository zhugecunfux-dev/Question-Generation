import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseCodexJson,
  planGenerationSlots,
  validateModelQuestion,
  type ModelQuestion,
} from "@/lib/llm/generate";

const detailedPrompt =
  "Create a 640 by 420 white SVG canvas. Draw black x and y axes from (80,350) to (580,350) and (80,350) to (80,50), with arrowheads, labelled time / s and velocity / m s^-1. Add ticks every 1 s and 5 m s^-1, then a 3 px blue line from (80,350) to (330,100) and horizontally to (580,100). Use 18 px sans-serif labels and keep every coordinate and value legible.";
const detailedBaseImagePrompt =
  "Use case: scientific-educational. Create a clean, realistic but uncluttered side-view illustration of a uniform beam balanced on a triangular pivot on a white studio background. Place the pivot at 42% of the canvas width, keep the beam horizontal, and leave generous clear zones above the left end, above the right end, and below the pivot for a later exact vector overlay. Use neutral grey materials, soft even lighting, crisp edges, and the same 640 by 420 landscape aspect ratio. No text, no labels, no numbers, no arrows, no dimensions, no watermark.";

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

test("sequential generation slots balance filters and reserve only the aggregate figure quota", () => {
  const slots = planGenerationSlots({
    topicIds: ["T2", "T3"],
    formats: ["mcq", "structured", "data_based", "free_response"],
    difficulties: ["easy", "medium", "hard"],
    count: 15,
  });

  assert.equal(slots.length, 15);
  assert.equal(slots.filter((slot) => slot.figureRequired).length, 5);
  assert.deepEqual(
    slots.filter((slot) => slot.figureRequired).map((slot) => slot.number),
    [2, 5, 8, 11, 14],
  );
  for (const key of ["topicId", "format", "difficulty"] as const) {
    const counts = new Map<string, number>();
    for (const slot of slots) {
      counts.set(slot[key], (counts.get(slot[key]) ?? 0) + 1);
    }
    const frequencies = [...counts.values()];
    assert.ok(Math.max(...frequencies) - Math.min(...frequencies) <= 1);
  }

  const teacherDirected = planGenerationSlots({
    topicIds: ["T2"],
    formats: ["mcq", "structured", "data_based", "free_response"],
    difficulties: ["hard"],
    count: 15,
    notes: "5 mcq",
  });
  assert.equal(teacherDirected.filter((slot) => slot.format === "mcq").length, 5);
});

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

test("SVG validation allows internal marker references but rejects external URLs", () => {
  const internalMarker =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3"><path d="M0 0 L10 3 L0 6 Z"/></marker></defs><line x1="80" y1="350" x2="560" y2="70" stroke="black" marker-end="url(#arrow)"/></svg>';
  assert.equal(
    validateModelQuestion(
      question({ figure: { ...question().figure!, svg: internalMarker } }),
      ["T2"],
    ),
    undefined,
  );

  const externalMarker = internalMarker.replace(
    "url(#arrow)",
    "url(https://example.com/arrow.svg#arrow)",
  );
  assert.match(
    validateModelQuestion(
      question({ figure: { ...question().figure!, svg: externalMarker } }),
      ["T2"],
    ) ?? "",
    /unsafe or external/,
  );
});

test("Turning Effect hybrid figures separate ImageGen pixels from exact SVG labels", () => {
  const overlaySvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420"><text x="80" y="80">12 N</text><path d="M80 90 V180" stroke="black"/></svg>';
  const hybrid = question({
    topicId: "T4",
    subtopicId: "T4.1",
    stem: "Fig. 1 shows a beam in equilibrium about a pivot. Calculate the unknown force.",
    figure: {
      ...question().figure!,
      mode: "imagegen_overlay",
      baseImagePrompt: detailedBaseImagePrompt,
      overlaySvg,
    },
  });
  assert.equal(validateModelQuestion(hybrid, ["T4"]), undefined);
  assert.match(
    validateModelQuestion(
      {
        ...hybrid,
        figure: {
          ...hybrid.figure!,
          baseImagePrompt: detailedBaseImagePrompt.replace("No text", "Include text"),
        },
      },
      ["T4"],
    ) ?? "",
    /must explicitly forbid/i,
  );
  assert.match(
    validateModelQuestion({ ...hybrid, topicId: "T3" }, ["T3"]) ?? "",
    /reserved for T4/i,
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
