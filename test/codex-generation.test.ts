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

test("Turning Effect slots rotate through figure-compatible and text-compatible question types", () => {
  const slots = planGenerationSlots({
    topicIds: ["T4"],
    formats: ["structured"],
    difficulties: ["easy", "medium", "hard"],
    count: 6,
  });

  assert.ok(
    slots.every(
      (slot) =>
        slot.turningEffectQuestionType || slot.sectionCQuestionPattern,
    ),
  );
  assert.equal(
    new Set(
      slots.map(
        (slot) =>
          slot.turningEffectQuestionType ?? slot.sectionCQuestionPattern,
      ),
    ).size,
    slots.length,
  );
  assert.match(
    slots.find((slot) => slot.figureRequired)?.turningEffectQuestionType ?? "",
    /identify which labelled length is the perpendicular distance/i,
  );
  assert.ok(
    slots
      .filter((slot) => !slot.figureRequired)
      .some((slot) => /centre of gravity/i.test(slot.turningEffectQuestionType ?? "")),
  );

  const mixedTopicSlots = planGenerationSlots({
    topicIds: ["T4", "T2", "T3"],
    formats: ["structured"],
    difficulties: ["medium"],
    count: 9,
  });
  assert.equal(
    mixedTopicSlots.filter((slot) => slot.figureRequired).length,
    3,
  );
  assert.ok(
    mixedTopicSlots.some(
      (slot) =>
        slot.topicId === "T4" &&
        slot.figureRequired &&
        /identify which labelled length/i.test(
          slot.turningEffectQuestionType ?? "",
      ),
    ),
  );

  const threeQuestionSet = planGenerationSlots({
    topicIds: ["T4"],
    formats: ["structured"],
    difficulties: ["medium"],
    count: 3,
  }).map((slot) => slot.turningEffectQuestionType ?? "");
  assert.ok(threeQuestionSet.some((type) => /moment concept/i.test(type)));
  assert.ok(threeQuestionSet.some((type) => /identify which labelled length/i.test(type)));
  assert.ok(threeQuestionSet.some((type) => /centre of gravity/i.test(type)));
});

test("hard written slots use Section C patterns and avoid MCQ when the requested mix permits it", () => {
  const slots = planGenerationSlots({
    topicIds: ["T2", "T3", "T4"],
    formats: ["mcq", "structured", "free_response"],
    difficulties: ["hard", "easy"],
    count: 6,
  });

  const hardSlots = slots.filter((slot) => slot.difficulty === "hard");
  assert.equal(hardSlots.length, 3);
  assert.ok(hardSlots.every((slot) => slot.format !== "mcq"));
  assert.ok(hardSlots.every((slot) => slot.sectionCQuestionPattern));
  assert.ok(
    slots
      .filter((slot) => slot.difficulty === "easy")
      .every((slot) => !slot.sectionCQuestionPattern),
  );
  assert.match(
    hardSlots.find((slot) => slot.topicId === "T4")
      ?.sectionCQuestionPattern ?? "",
    /principle-of-moments|vertical force balance|rotational and translational equilibrium/i,
  );
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

test("Turning Effect scope accepts direct lever arms and rejects trigonometry or force resolution", () => {
  const directMoment = question({
    topicId: "T4",
    subtopicId: "T4.1",
    stem:
      "A vertical force of 40 N acts with a labelled perpendicular distance of 0.30 m from a pivot. Calculate its moment.",
    answer: "12 N m",
    solution:
      "The perpendicular distance is given directly. M = Fd = 40 × 0.30 = 12 N m, clockwise.",
    figure: undefined,
  });
  assert.equal(validateModelQuestion(directMoment, ["T4"]), undefined);
  assert.equal(
    validateModelQuestion(
      {
        ...directMoment,
        solution:
          "Resolve the force into T cos 25° and T sin 25° before calculating the moment.",
      },
      ["T4"],
    ),
    "T4 scope forbids trigonometry and inverse trigonometry",
  );
  assert.equal(
    validateModelQuestion(
      {
        ...directMoment,
        solution:
          "First calculate the perpendicular distance using d = 0.80 sin 50°, then use M = Fd.",
      },
      ["T4"],
    ),
    "T4 scope forbids trigonometry and inverse trigonometry",
  );
  assert.equal(
    validateModelQuestion(
      {
        ...directMoment,
        solution:
          "Use tan θ = 0.60 / 0.90 and θ = tan⁻¹(0.60 / 0.90) to find the angle.",
      },
      ["T4"],
    ),
    "T4 scope forbids trigonometry and inverse trigonometry",
  );
  assert.equal(
    validateModelQuestion(
      {
        ...directMoment,
        solution:
          "Resolve the force into horizontal and vertical components before taking moments.",
      },
      ["T4"],
    ),
    "T4 scope forbids resolving forces into components",
  );
  assert.equal(
    validateModelQuestion(
      {
        ...directMoment,
        stem:
          "A 40 N force acts at 35 degrees to a lever. Calculate the turning effect.",
      },
      ["T4"],
    ),
    "T4 scope forbids numerical non-right angles",
  );
});

test("Section-based difficulty validation requires a linked calculation and explanation for hard questions", () => {
  const hardKinematics = question({
    difficulty: "hard",
    marks: 8,
    stem:
      "(a) Calculate the displacement of each cyclist at 20 s and hence determine their separation. (b) Explain how their separation changes after 20 s using their relative velocities.",
    answer: "Their separation is 40 m and then decreases.",
    solution:
      "Calculate both signed graph areas and subtract them. After 20 s the cyclist behind has the greater velocity, so the separation decreases.",
    figure: undefined,
  });
  assert.equal(validateModelQuestion(hardKinematics, ["T2"]), undefined);
  assert.equal(
    validateModelQuestion(
      {
        ...hardKinematics,
        stem:
          "(a) Calculate the displacement of each cyclist at 20 s and hence determine their separation.",
      },
      ["T2"],
    ),
    "hard Section C-style question must include an explicit explanation or justification task",
  );
  assert.equal(
    validateModelQuestion({ ...hardKinematics, marks: 6 }, ["T2"]),
    "hard Section C-style question must be worth at least 7 marks",
  );

  const hardTurningEffects = question({
    topicId: "T4",
    subtopicId: "T4.1",
    difficulty: "hard",
    marks: 9,
    stem:
      "(a) Taking moments about a suitable support, calculate the reaction at the other support. (b) Use vertical force balance to determine the first reaction. (c) Explain how moving the load changes the two reactions.",
    answer: "The reactions are 420 N and 280 N.",
    solution:
      "Apply the principle of moments for rotational equilibrium. Then use translational equilibrium: total upward force equals total downward force. Moving the load changes its moment and transfers load between the supports.",
    figure: undefined,
  });
  assert.equal(validateModelQuestion(hardTurningEffects, ["T4"]), undefined);
  assert.equal(
    validateModelQuestion(
      {
        ...hardTurningEffects,
        stem:
          "(a) Taking moments about a suitable support, calculate the reaction at the other support. (b) Explain how moving the load changes that reaction.",
        solution:
          "Apply the principle of moments for rotational equilibrium, then explain how the load moment changes.",
      },
      ["T4"],
    ),
    "T4 hard Section C-style question must also use translational equilibrium",
  );

  assert.equal(
    validateModelQuestion(
      question({ difficulty: "easy", marks: 4, figure: undefined }),
      ["T2"],
    ),
    "easy written question must be worth 1-3 marks",
  );
  assert.equal(
    validateModelQuestion(
      question({
        difficulty: "easy",
        marks: 2,
        stem: "State what is meant by acceleration.",
        answer: "The rate of change of velocity.",
        solution: "Change of velocity per unit time.",
        figure: undefined,
      }),
      ["T2"],
    ),
    undefined,
  );
  assert.equal(
    validateModelQuestion(
      question({ difficulty: "medium", marks: 2, figure: undefined }),
      ["T2"],
    ),
    "medium Section B-style question must be worth 3-6 marks",
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
