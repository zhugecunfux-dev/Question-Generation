import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseCsv, parseEntries, parseImportPayload } from "@/lib/import";

test("accepts a well-formed mcq", () => {
  const { entries, issues } = parseEntries([
    {
      id: "x1",
      topicId: "T2",
      format: "mcq",
      difficulty: "easy",
      ao: "AO2",
      marks: 1,
      stem: "What is the speed?",
      options: [
        { label: "A", text: "8 m/s", correct: true },
        { label: "B", text: "4 m/s", correct: false },
      ],
      tags: "demo,kinematics",
    },
  ]);
  assert.equal(issues.length, 0);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].tags, ["demo", "kinematics"]);
});

test("normalises loose topic ids", () => {
  const { entries } = parseEntries([
    { id: "a", topicId: "3", format: "structured", stem: "s", answer: "a", marks: 2 },
    { id: "b", topicId: "Topic 07", format: "structured", stem: "s", answer: "a", marks: 2 },
  ]);
  assert.deepEqual(entries.map((e) => e.topicId), ["T3", "T7"]);
});

test("rejects out-of-syllabus topics, bad mcqs, and duplicates", () => {
  const { entries, issues } = parseEntries([
    { id: "a", topicId: "T99", format: "structured", stem: "s", answer: "a" },
    {
      id: "b",
      topicId: "T2",
      format: "mcq",
      stem: "s",
      options: [
        { label: "A", text: "x", correct: true },
        { label: "B", text: "y", correct: true },
      ],
    },
    { id: "c", topicId: "T2", format: "structured", stem: "s", answer: "a" },
    { id: "c", topicId: "T2", format: "structured", stem: "s2", answer: "a" },
  ]);
  assert.equal(entries.length, 1);
  assert.ok(issues.some((i) => /not in the 6091 syllabus/.test(i.message)));
  assert.ok(issues.some((i) => /exactly 1 correct option/.test(i.message)));
  assert.ok(issues.some((i) => /duplicate id/.test(i.message)));
});

test("rejects a template that cannot expand", () => {
  const { entries, issues } = parseEntries([
    {
      kind: "template",
      id: "bad",
      topicId: "T2",
      format: "structured",
      marks: 2,
      stem: "{{a}}",
      variables: [{ name: "a", type: "int", min: 1, max: 5 }],
      constraints: ["a > 100"],
      answer: { value: "a" },
    },
  ]);
  assert.equal(entries.length, 0);
  assert.ok(issues.some((i) => /does not expand/.test(i.message)));
});

test("parses CSV including quoted fields with commas", () => {
  const rows = parseCsv(
    'id,topicId,format,stem,answer,marks\n' +
      'c1,T6,structured,"Work done, in joules, is?","W = Fd",2\n',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stem, "Work done, in joules, is?");
  const { entries, issues } = parseEntries(rows);
  assert.equal(issues.length, 0);
  assert.equal(entries[0].topicId, "T6");
});

test("wrapper objects contribute both questions and templates", () => {
  const seed = fs.readFileSync(
    path.join(process.cwd(), "data", "questions", "seed.json"),
    "utf8",
  );
  const { entries, issues } = parseImportPayload(seed, "seed.json");
  assert.deepEqual(issues, [], "the shipped seed bank must import cleanly");
  assert.ok(entries.some((e) => e.kind === "static"));
  assert.ok(entries.some((e) => e.kind === "template"));
});
