import assert from "node:assert/strict";
import { test } from "node:test";
import { expandTemplate, renderTemplate } from "@/lib/template/engine";
import { allocate } from "@/lib/paper";
import type { QuestionTemplate } from "@/lib/types";

const accelTemplate: QuestionTemplate = {
  kind: "template",
  id: "t-accel",
  source: "test",
  topicId: "T2",
  format: "mcq",
  difficulty: "easy",
  ao: "AO2",
  marks: 1,
  stem: "A car speeds up from {{u}} m/s to {{v}} m/s in {{t}} s. What is its acceleration?",
  variables: [
    { name: "u", type: "int", min: 2, max: 14, step: 2 },
    { name: "v", type: "int", min: 16, max: 40, step: 2 },
    { name: "t", type: "int", min: 2, max: 10, step: 1 },
  ],
  constraints: ["v > u"],
  derived: [{ name: "a", expr: "(v - u) / t", sigfig: 3 }],
  answer: { value: "a", unit: "m/s^2", sigfig: 3 },
  options: [
    { expr: "(v - u) / t", correct: true },
    { expr: "(v + u) / t" },
    { expr: "v / t" },
    { expr: "(v - u) * t" },
  ],
  solution: "a = (v - u)/t = ({{v}} - {{u}})/{{t}} = {{a}} m/s^2",
  tags: ["test"],
  createdAt: "2026-01-01T00:00:00.000Z",
};

test("renderTemplate substitutes known placeholders and preserves unknown ones", () => {
  assert.equal(renderTemplate("{{a}} then {{b}}", { a: "1", b: "2" }), "1 then 2");
  assert.equal(renderTemplate("{{a}} and {{missing}}", { a: "1" }), "1 and {{missing}}");
});

test("expansion is deterministic for a given seed", () => {
  const first = expandTemplate(accelTemplate, { seed: 42, count: 5 });
  const second = expandTemplate(accelTemplate, { seed: 42, count: 5 });
  assert.equal(first.questions.length, 5);
  assert.deepEqual(
    first.questions.map((q) => q.stem),
    second.questions.map((q) => q.stem),
  );
  assert.deepEqual(
    first.questions.map((q) => q.options?.map((o) => o.text)),
    second.questions.map((q) => q.options?.map((o) => o.text)),
    "option order must also be seeded",
  );
});

test("different seeds produce different papers", () => {
  const a = expandTemplate(accelTemplate, { seed: 1, count: 5 });
  const b = expandTemplate(accelTemplate, { seed: 2, count: 5 });
  assert.notDeepEqual(a.questions.map((q) => q.stem), b.questions.map((q) => q.stem));
});

test("constraints hold and the computed answer is correct", () => {
  const { questions } = expandTemplate(accelTemplate, { seed: 7, count: 20 });
  assert.ok(questions.length > 0);
  for (const q of questions) {
    const m = /from (\d+) m\/s to (\d+) m\/s in (\d+) s/.exec(q.stem);
    assert.ok(m, `stem did not match expected shape: ${q.stem}`);
    const [u, v, t] = [Number(m[1]), Number(m[2]), Number(m[3])];
    assert.ok(v > u, "constraint v > u was violated");

    const key = q.options!.find((o) => o.correct)!;
    const expected = Number(((v - u) / t).toPrecision(3));
    assert.equal(Number(key.text.replace(" m/s^2", "")), expected);
  }
});

test("mcq variants have exactly one key and no duplicate option text", () => {
  const { questions } = expandTemplate(accelTemplate, { seed: 3, count: 15 });
  for (const q of questions) {
    assert.ok(q.options && q.options.length >= 2);
    assert.equal(q.options.filter((o) => o.correct).length, 1);
    const texts = q.options.map((o) => o.text);
    assert.equal(new Set(texts).size, texts.length, `duplicate distractor in ${q.id}`);
  }
});

test("variants are deduplicated rather than repeated", () => {
  const tiny: QuestionTemplate = {
    ...accelTemplate,
    id: "t-tiny",
    format: "structured",
    options: undefined,
    variables: [
      { name: "u", type: "int", min: 2, max: 4, step: 2 },
      { name: "v", type: "int", min: 10, max: 10 },
      { name: "t", type: "int", min: 5, max: 5 },
    ],
  };
  const { questions, warnings } = expandTemplate(tiny, { seed: 9, count: 10 });
  const stems = questions.map((q) => q.stem);
  assert.equal(new Set(stems).size, stems.length, "duplicate stems were emitted");
  assert.ok(questions.length <= 2, "cannot exceed the size of the variable space");
  assert.ok(warnings.length > 0, "exhausting the space should warn, not silently truncate");
});

test("allocate spreads a count evenly across buckets", () => {
  assert.deepEqual(allocate(10, 3), [4, 3, 3]);
  assert.deepEqual(allocate(2, 5), [1, 1, 0, 0, 0]);
  assert.deepEqual(allocate(9, 3), [3, 3, 3]);
  assert.deepEqual(allocate(5, 0), []);
});
