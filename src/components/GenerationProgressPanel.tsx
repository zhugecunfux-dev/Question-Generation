import type {
  GenerationPhase,
  GenerationProgress,
  GenerationProgressEvent,
} from "@/lib/generation-progress";

const PHASES: Array<{ id: GenerationPhase; title: string; subtitle: string }> = [
  {
    id: "questions",
    title: "Question writing",
    subtitle: "Bank context → Codex draft → physics checks",
  },
  {
    id: "layout",
    title: "Figures & layout",
    subtitle: "SVG checks → asset storage → paper assembly",
  },
];

function StatusDot({ status }: { status: GenerationProgressEvent["status"] }) {
  const style =
    status === "done"
      ? "bg-emerald-500"
      : status === "active"
        ? "animate-pulse bg-[var(--color-accent)]"
        : status === "error"
          ? "bg-red-500"
          : "bg-neutral-300 dark:bg-neutral-700";
  return <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style}`} />;
}

export function GenerationProgressPanel({
  progress,
  compact = false,
}: {
  progress: GenerationProgress;
  compact?: boolean;
}) {
  const stateLabel =
    progress.status === "completed"
      ? "Complete"
      : progress.status === "failed"
        ? "Needs attention"
        : "In progress";
  const stateStyle =
    progress.status === "completed"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
      : progress.status === "failed"
        ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200"
        : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200";

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-[var(--color-line)] bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-[var(--color-line)] p-4 dark:border-neutral-800">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
              Codex generation
            </p>
            <h2 className="mt-1 text-lg font-semibold">{progress.headline}</h2>
            {progress.detail && (
              <p className="mt-1 text-sm text-[var(--color-ink-soft)] dark:text-neutral-400">
                {progress.detail}
              </p>
            )}
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${stateStyle}`}>
            {stateLabel}
          </span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              progress.status === "failed" ? "bg-red-500" : "bg-[var(--color-accent)]"
            }`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-[var(--color-ink-soft)] dark:text-neutral-500">
          <span>{progress.stage.replaceAll("_", " ")}</span>
          <span>{progress.percent}%</span>
        </div>
      </div>

      <div className={`grid gap-3 p-4 ${compact ? "md:grid-cols-2" : "lg:grid-cols-2"}`}>
        {PHASES.map((phase) => {
          const events = progress.events.filter((event) => event.phase === phase.id);
          return (
            <div
              key={phase.id}
              className="rounded-lg border border-[var(--color-line)] bg-neutral-50/70 p-3 dark:border-neutral-800 dark:bg-neutral-950/40"
            >
              <h3 className="text-sm font-semibold">{phase.title}</h3>
              <p className="mt-0.5 text-xs text-[var(--color-ink-soft)] dark:text-neutral-500">
                {phase.subtitle}
              </p>
              <div className="mt-3 space-y-2.5">
                {events.length ? (
                  events.map((event) => (
                    <div key={event.id} className="flex gap-2.5">
                      <StatusDot status={event.status} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{event.title}</p>
                        {event.detail && (
                          <p className="mt-0.5 text-xs leading-5 text-[var(--color-ink-soft)] dark:text-neutral-500">
                            {event.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex gap-2.5 text-sm text-[var(--color-ink-soft)] dark:text-neutral-500">
                    <StatusDot status="waiting" />
                    <span>Waiting for this phase</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!compact && (
        <div className="border-t border-[var(--color-line)] px-4 py-3 text-xs text-[var(--color-ink-soft)] dark:border-neutral-800 dark:text-neutral-500">
          Requested {progress.requestedCount} question(s)
          {progress.exemplarCount !== undefined ? ` · ${progress.exemplarCount} bank exemplar(s)` : ""}
          {progress.questionCount !== undefined ? ` · ${progress.questionCount} validated` : ""}
          {progress.figureCount !== undefined ? ` · ${progress.figureCount} SVG figure(s)` : ""}
        </div>
      )}
    </section>
  );
}
