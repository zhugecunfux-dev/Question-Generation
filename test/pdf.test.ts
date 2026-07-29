import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPaperPdf,
  parsePdfExportRequest,
  pdfFilename,
  printableText,
} from "@/lib/pdf.server";
import type { GeneratedPaper, Question } from "@/lib/types";

const question: Question = {
  kind: "static",
  id: "pdf-test-1",
  source: "test",
  topicId: "T2",
  format: "mcq",
  difficulty: "medium",
  ao: "AO2",
  marks: 1,
  stem: "A trolley moves at $4.0\\,\\mathrm{m\\,s^{-1}}$. What does the graph show?",
  options: [
    { label: "A", text: "constant acceleration", correct: false },
    { label: "B", text: "constant velocity", correct: true },
  ],
  assets: [
    {
      path: "seed/velocity-time-trolley.svg",
      caption: "Fig. 1",
      alt: "Velocity-time graph for a trolley",
    },
  ],
  answer: "B",
  solution: "A horizontal velocity-time graph represents constant velocity.",
  tags: [],
  createdAt: "2026-07-28T00:00:00.000Z",
};

const paper: GeneratedPaper = {
  mode: "retrieve",
  generatedAt: "2026-07-28T00:00:00.000Z",
  seed: 42,
  totalMarks: 1,
  questions: [question],
  warnings: [],
};

test("printableText converts common lightweight LaTeX", () => {
  assert.equal(
    printableText("$4.0\\,\\mathrm{m\\,s^{-1}}$ and $3\\times10^{2}$"),
    "4.0 m s⁻¹ and 3×10²",
  );
});

test("PDF export request is validated and total marks are recomputed", () => {
  const parsed = parsePdfExportRequest({
    paper: { ...paper, totalMarks: 999 },
    withAnswers: true,
  });
  assert.equal(parsed.withAnswers, true);
  assert.equal(parsed.paper.totalMarks, 1);
  assert.throws(
    () => parsePdfExportRequest({ paper: { ...paper, questions: [] } }),
    /must not be empty/,
  );
});

test("paper PDF renders questions, SVG figures and answer version", async () => {
  const plain = await createPaperPdf(paper, { withAnswers: false });
  const answers = await createPaperPdf(paper, { withAnswers: true });
  assert.equal(plain.subarray(0, 4).toString("ascii"), "%PDF");
  assert.equal(answers.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(plain.length > 4_000);
  assert.ok(answers.length > 4_000);
  assert.equal(pdfFilename(false), "6091-paper.pdf");
  assert.equal(pdfFilename(true), "6091-paper-with-answers.pdf");
});

test("saved PDF filenames cannot escape output/pdf", async () => {
  const { savePaperPdf } = await import("@/lib/pdf.server");
  await assert.rejects(
    () => savePaperPdf(paper, { withAnswers: false, filename: "../outside.pdf" }),
    /safe local .pdf basename/,
  );
});
