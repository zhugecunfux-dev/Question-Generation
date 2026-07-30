"use client";

import { useEffect, useMemo, useState } from "react";
import { GenerationProgressPanel } from "@/components/GenerationProgressPanel";
import type { GenerationProgress } from "@/lib/generation-progress";

export default function ProgressPage() {
  const threadId = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("threadId"),
    [],
  );
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!threadId) {
      setError("No Codex generation thread was supplied.");
      return;
    }
    let stopped = false;
    let timer: number | undefined;

    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/generation-progress?threadId=${encodeURIComponent(threadId)}`,
          { cache: "no-store" },
        );
        if (response.status === 404) return;
        const data = (await response.json()) as {
          progress?: GenerationProgress;
          error?: string;
        };
        if (!response.ok || !data.progress) {
          throw new Error(data.error ?? "Could not read generation progress.");
        }
        if (stopped) return;
        setProgress(data.progress);
        setError(null);
        if (data.progress.status === "completed" || data.progress.status === "failed") {
          if (timer !== undefined) window.clearInterval(timer);
        }
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    void refresh();
    timer = window.setInterval(() => void refresh(), 900);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [threadId]);

  return (
    <main className="mx-auto max-w-5xl py-2">
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Live generation
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Building your physics practice paper
          </h1>
          <p className="mt-2 text-sm text-[var(--color-ink-soft)] dark:text-neutral-400">
            This window follows real server stages. You can leave it open while Codex writes,
            checks, illustrates, and assembles the paper.
          </p>
        </div>
        {threadId && (
          <a
            href={`/agent?threadId=${encodeURIComponent(threadId)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm font-medium hover:border-[var(--color-accent)] dark:border-neutral-800 dark:bg-neutral-900"
          >
            Open raw Codex thread
          </a>
        )}
      </div>

      {progress ? (
        <GenerationProgressPanel progress={progress} />
      ) : (
        <section className="rounded-xl border border-[var(--color-line)] bg-white p-8 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-neutral-200 border-t-[var(--color-accent)] dark:border-neutral-700" />
          <h2 className="mt-4 font-semibold">Connecting to the generation job</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)] dark:text-neutral-400">
            Waiting for the question-bank preparation stage to begin.
          </p>
        </section>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <a href="/" className="text-[var(--color-accent)] underline">
          Return to generated paper
        </a>
        {threadId && (
          <span className="font-mono text-[10px] text-[var(--color-ink-soft)] dark:text-neutral-500">
            {threadId}
          </span>
        )}
      </div>
    </main>
  );
}
