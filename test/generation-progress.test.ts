import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginGenerationProgress,
  completeGenerationProgress,
  failGenerationProgress,
  getGenerationProgress,
  reportGenerationProgress,
} from "@/lib/generation-progress.server";

test("generation progress records real stages and updates events in place", () => {
  const threadId = `progress-${Date.now()}-success`;
  beginGenerationProgress({
    threadId,
    requestedCount: 10,
    topicIds: ["T2"],
    formatLabels: ["mcq"],
    difficultyLabels: ["easy"],
  });

  reportGenerationProgress(threadId, {
    status: "running",
    stage: "bank_context",
    headline: "Reading the question bank",
    percent: 14,
    exemplarCount: 4,
    event: {
      id: "bank_context",
      phase: "questions",
      title: "Read matching bank questions",
      detail: "4 matching exemplars",
      status: "done",
    },
  });
  reportGenerationProgress(threadId, {
    stage: "codex_writing",
    headline: "Writing questions",
    percent: 45,
    event: {
      id: "codex_draft",
      phase: "questions",
      title: "Draft questions and diagrams",
      status: "active",
    },
  });
  reportGenerationProgress(threadId, {
    stage: "draft_received",
    headline: "Draft received",
    percent: 66,
    event: {
      id: "codex_draft",
      phase: "questions",
      title: "Draft questions and diagrams",
      status: "done",
    },
  });

  const completed = completeGenerationProgress(threadId, "10 questions ready");
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.percent, 100);
  assert.equal(completed?.exemplarCount, 4);
  assert.equal(
    completed?.events.filter((event) => event.id === "codex_draft").length,
    1,
    "stage updates should replace an event rather than duplicate it",
  );
  assert.equal(getGenerationProgress(threadId)?.completedAt !== undefined, true);
});

test("generation progress preserves an actionable failure", () => {
  const threadId = `progress-${Date.now()}-failure`;
  beginGenerationProgress({
    threadId,
    requestedCount: 3,
    topicIds: ["T15"],
    formatLabels: ["structured"],
    difficultyLabels: ["medium"],
  });
  const failed = failGenerationProgress(threadId, new Error("SVG validation failed"));
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.percent, 100);
  assert.match(failed?.error ?? "", /SVG validation failed/);
  assert.equal(failed?.events.at(-1)?.status, "error");
});
