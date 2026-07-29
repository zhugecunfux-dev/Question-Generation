import type {
  GenerationPhase,
  GenerationProgress,
  GenerationProgressEvent,
} from "@/lib/generation-progress";

const MAX_PROGRESS_RECORDS = 50;
const PROGRESS_TTL_MS = 6 * 60 * 60 * 1_000;

const globalWithProgress = globalThis as typeof globalThis & {
  __questionGenerationProgress?: Map<string, GenerationProgress>;
};

function store(): Map<string, GenerationProgress> {
  if (!globalWithProgress.__questionGenerationProgress) {
    globalWithProgress.__questionGenerationProgress = new Map();
  }
  return globalWithProgress.__questionGenerationProgress;
}

function prune(): void {
  const records = store();
  const cutoff = Date.now() - PROGRESS_TTL_MS;
  for (const [threadId, progress] of records) {
    if (new Date(progress.updatedAt).getTime() < cutoff) records.delete(threadId);
  }
  if (records.size <= MAX_PROGRESS_RECORDS) return;
  const oldest = [...records.values()]
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, records.size - MAX_PROGRESS_RECORDS);
  for (const progress of oldest) records.delete(progress.threadId);
}

export function beginGenerationProgress(input: {
  threadId: string;
  requestedCount: number;
  topicIds: string[];
  formatLabels: string[];
  difficultyLabels: string[];
}): GenerationProgress {
  prune();
  const now = new Date().toISOString();
  const progress: GenerationProgress = {
    threadId: input.threadId,
    status: "queued",
    stage: "queued",
    headline: "Generation request queued",
    detail: "Preparing the question-bank context for Codex.",
    percent: 3,
    requestedCount: input.requestedCount,
    topicIds: input.topicIds,
    formatLabels: input.formatLabels,
    difficultyLabels: input.difficultyLabels,
    startedAt: now,
    updatedAt: now,
    events: [
      {
        id: "queued",
        phase: "system",
        title: "Request accepted",
        detail: `${input.requestedCount} question(s) requested`,
        status: "done",
        at: now,
      },
    ],
  };
  store().set(input.threadId, progress);
  return progress;
}

export function reportGenerationProgress(
  threadId: string,
  update: Partial<
    Pick<
      GenerationProgress,
      | "status"
      | "stage"
      | "headline"
      | "detail"
      | "percent"
      | "exemplarCount"
      | "questionCount"
      | "figureCount"
    >
  > & {
    event?: {
      id: string;
      phase: GenerationPhase;
      title: string;
      detail?: string;
      status: GenerationProgressEvent["status"];
    };
  },
): GenerationProgress | undefined {
  const current = store().get(threadId);
  if (!current) return undefined;
  const now = new Date().toISOString();
  const events = current.events.slice();
  if (update.event) {
    const nextEvent: GenerationProgressEvent = { ...update.event, at: now };
    const index = events.findIndex((event) => event.id === nextEvent.id);
    if (index >= 0) events[index] = nextEvent;
    else events.push(nextEvent);
  }
  const next: GenerationProgress = {
    ...current,
    ...update,
    percent: Math.max(current.percent, Math.min(100, update.percent ?? current.percent)),
    updatedAt: now,
    events: events.slice(-40),
  };
  delete (next as GenerationProgress & { event?: unknown }).event;
  store().set(threadId, next);
  return next;
}

export function completeGenerationProgress(
  threadId: string,
  detail: string,
): GenerationProgress | undefined {
  const now = new Date().toISOString();
  const next = reportGenerationProgress(threadId, {
    status: "completed",
    stage: "completed",
    headline: "Paper ready",
    detail,
    percent: 100,
    event: {
      id: "completed",
      phase: "system",
      title: "Generation complete",
      detail,
      status: "done",
    },
  });
  if (next) {
    next.completedAt = now;
    store().set(threadId, next);
  }
  return next;
}

export function failGenerationProgress(
  threadId: string,
  error: unknown,
): GenerationProgress | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const now = new Date().toISOString();
  const next = reportGenerationProgress(threadId, {
    status: "failed",
    stage: "failed",
    headline: "Generation stopped",
    detail: message,
    percent: 100,
    event: {
      id: "failed",
      phase: "system",
      title: "Generation failed",
      detail: message,
      status: "error",
    },
  });
  if (next) {
    next.error = message;
    next.completedAt = now;
    store().set(threadId, next);
  }
  return next;
}

export function getGenerationProgress(threadId: string): GenerationProgress | undefined {
  prune();
  return store().get(threadId);
}
