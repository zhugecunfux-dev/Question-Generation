import assert from "node:assert/strict";
import test from "node:test";
import {
  beginGenerationProgress,
  getGenerationProgress,
  reportGenerationProgress,
} from "@/lib/generation-progress.server";

test("generation progress preserves Knowledge Base source and excerpt counts", () => {
  const threadId = `knowledge-progress-${Date.now()}`;
  beginGenerationProgress({
    threadId,
    requestedCount: 5,
    topicIds: ["T2"],
    formatLabels: ["structured"],
    difficultyLabels: ["medium"],
  });
  reportGenerationProgress(threadId, {
    status: "running",
    stage: "knowledge_context",
    headline: "Retrieving Knowledge Base examples",
    percent: 10,
    knowledgeSourceCount: 2,
    knowledgeExcerptCount: 8,
    event: {
      id: "knowledge_context",
      phase: "questions",
      title: "Retrieve Knowledge Base examples",
      detail: "8 excerpts from 2 sources",
      status: "done",
    },
  });

  const progress = getGenerationProgress(threadId);
  assert.equal(progress?.knowledgeSourceCount, 2);
  assert.equal(progress?.knowledgeExcerptCount, 8);
  assert.equal(progress?.events.at(-1)?.id, "knowledge_context");
});
