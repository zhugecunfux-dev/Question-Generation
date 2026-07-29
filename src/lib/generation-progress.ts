export type GenerationPhase = "questions" | "layout" | "system";
export type GenerationStatus = "queued" | "running" | "completed" | "failed";

export interface GenerationProgressEvent {
  id: string;
  phase: GenerationPhase;
  title: string;
  detail?: string;
  status: "waiting" | "active" | "done" | "error";
  at: string;
}

export interface GenerationProgress {
  threadId: string;
  status: GenerationStatus;
  stage: string;
  headline: string;
  detail?: string;
  percent: number;
  requestedCount: number;
  topicIds: string[];
  formatLabels: string[];
  difficultyLabels: string[];
  exemplarCount?: number;
  questionCount?: number;
  figureCount?: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  events: GenerationProgressEvent[];
}
