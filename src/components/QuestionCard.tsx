"use client";

import { useEffect, useState } from "react";
import type { BankEntry, Question, QuestionAsset, QuestionTemplate } from "@/lib/types";
import { assetUrl } from "@/lib/assets";

interface ImagegenJobView {
  status: "pending" | "dispatched" | "ready" | "failed";
  updatedAt: string;
  illustrationThreadId?: string;
  error?: string;
}

function FigureAsset({ asset }: { asset: QuestionAsset }) {
  const [job, setJob] = useState<ImagegenJobView | null>(null);
  const [handoffPrompt, setHandoffPrompt] = useState("");
  const [jobError, setJobError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!asset.imageGenerationJob) return;
    let stopped = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/imagegen/jobs?path=${encodeURIComponent(asset.imageGenerationJob!)}`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as {
          job?: ImagegenJobView;
          handoffPrompt?: string;
          error?: string;
        };
        if (!response.ok || !data.job) {
          throw new Error(data.error ?? "Could not read the ImageGen job.");
        }
        if (stopped) return;
        setJob(data.job);
        setHandoffPrompt(data.handoffPrompt ?? "");
        setJobError(null);
        if (data.job.status === "ready" || data.job.status === "failed") {
          if (timer !== undefined) window.clearInterval(timer);
        }
      } catch (cause) {
        if (!stopped) {
          setJobError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };
    void refresh();
    timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [asset.imageGenerationJob]);

  async function sendToCodex() {
    if (!asset.imageGenerationJob) return;
    const taskWindow = window.open("about:blank", "qg-imagegen-task");
    setSending(true);
    setJobError(null);
    try {
      const response = await fetch("/api/imagegen/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: asset.imageGenerationJob,
          retry: job?.status === "failed",
        }),
      });
      const data = (await response.json()) as {
        threadId?: string;
        job?: ImagegenJobView;
        error?: string;
      };
      if (!response.ok || !data.threadId) {
        throw new Error(data.error ?? "Could not start the ImageGen Codex task.");
      }
      if (data.job) setJob(data.job);
      if (taskWindow) {
        taskWindow.location.href = `/agent?threadId=${encodeURIComponent(data.threadId)}`;
      }
    } catch (cause) {
      taskWindow?.close();
      setJobError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  }

  async function copyPrompt() {
    if (!handoffPrompt) return;
    try {
      await navigator.clipboard.writeText(handoffPrompt);
      setJobError("ImageGen handoff prompt copied.");
    } catch {
      setJobError("Could not copy the ImageGen handoff prompt.");
    }
  }

  const threadId = job?.illustrationThreadId ?? asset.imageGenerationThreadId;
  const imageSrc =
    assetUrl(asset.path) +
    (job?.status === "ready" ? `?v=${encodeURIComponent(job.updatedAt)}` : "");

  return (
    <figure className="m-0 max-w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt={asset.alt ?? asset.caption ?? "Figure for this question"}
        width={asset.width}
        height={asset.height}
        className="max-w-full rounded border border-[var(--color-line)] bg-white dark:border-neutral-700"
      />
      {asset.caption && (
        <figcaption className="mt-1 text-xs text-[var(--color-ink-soft)] dark:text-neutral-400">
          {asset.caption}
        </figcaption>
      )}
      {asset.imageGenerationJob && (
        <div className="mt-2 flex max-w-xl flex-wrap items-center gap-2 rounded border border-blue-200 bg-blue-50 px-2.5 py-2 text-xs text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
          <span className="font-medium">
            {job?.status === "ready"
              ? "ImageGen base + exact SVG labels ready"
              : job?.status === "dispatched"
                ? "ImageGen is working; exact SVG fallback shown"
                : job?.status === "failed"
                  ? "ImageGen needs attention; exact SVG fallback shown"
                  : "Exact SVG fallback shown; ImageGen job ready"}
          </span>
          {threadId && (
            <a
              href={`/agent?threadId=${encodeURIComponent(threadId)}`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Open Codex task
            </a>
          )}
          {(job?.status === "pending" || job?.status === "failed") && (
            <button
              type="button"
              onClick={() => void sendToCodex()}
              disabled={sending}
              className="rounded border border-blue-300 bg-white px-2 py-1 font-medium disabled:opacity-50 dark:border-blue-800 dark:bg-neutral-900"
            >
              {sending ? "Sending…" : job.status === "failed" ? "Retry in Codex" : "Send to Codex"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void copyPrompt()}
            disabled={!handoffPrompt}
            className="rounded border border-blue-300 bg-white px-2 py-1 disabled:opacity-50 dark:border-blue-800 dark:bg-neutral-900"
          >
            Copy prompt
          </button>
          {jobError && <span className="basis-full text-[11px]">{jobError}</span>}
          {job?.error && (
            <span className="basis-full text-[11px] text-red-700 dark:text-red-300">
              {job.error}
            </span>
          )}
        </div>
      )}
    </figure>
  );
}

function Figures({ assets }: { assets: QuestionAsset[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {assets.map((asset) => <FigureAsset key={asset.path} asset={asset} />)}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-[var(--color-line)] bg-white px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-[var(--color-ink-soft)] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      {children}
    </span>
  );
}

export function QuestionCard({
  entry,
  index,
  showAnswers,
}: {
  entry: BankEntry;
  index?: number;
  showAnswers: boolean;
}) {
  const isTemplate = entry.kind === "template";
  // A template's `options` are expressions, not answer choices — rendering them
  // through the MCQ branch produces empty bullets. Keep the two paths separate.
  const q = isTemplate ? undefined : (entry as Question);
  const template = isTemplate ? (entry as QuestionTemplate) : undefined;

  return (
    <article className="rounded-lg border border-[var(--color-line)] bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {index !== undefined && (
          <span className="mr-1 font-semibold tabular-nums">{index}.</span>
        )}
        <Badge>{entry.topicId}</Badge>
        <Badge>{entry.format}</Badge>
        <Badge>{entry.difficulty}</Badge>
        <Badge>{entry.ao}</Badge>
        <Badge>{entry.marks}m</Badge>
        {isTemplate && <Badge>template</Badge>}
        {entry.tags.includes("needs-review") && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            needs review
          </span>
        )}
      </div>

      <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{entry.stem}</p>

      {entry.assets?.length ? <Figures assets={entry.assets} /> : null}

      {q?.options && (
        <ol className="mt-3 space-y-1 text-[15px]">
          {q.options.map((opt) => (
            <li
              key={opt.label}
              className={
                showAnswers && opt.correct
                  ? "font-medium text-[var(--color-accent)]"
                  : undefined
              }
            >
              <span className="mr-2 font-mono">{opt.label}.</span>
              {opt.text}
              {showAnswers && opt.correct && <span className="ml-2 text-xs">← key</span>}
            </li>
          ))}
        </ol>
      )}

      {showAnswers && q && (
        <div className="mt-3 border-t border-dashed border-[var(--color-line)] pt-3 text-sm dark:border-neutral-700">
          <p>
            <span className="font-semibold">Answer:</span> {q.answer}
          </p>
          {q.solution && (
            <p className="mt-1 whitespace-pre-wrap text-[var(--color-ink-soft)] dark:text-neutral-400">
              <span className="font-semibold text-[var(--color-ink)] dark:text-neutral-200">
                Mark scheme:
              </span>{" "}
              {q.solution}
            </p>
          )}
        </div>
      )}

      {template && (
        <dl className="mt-3 space-y-1 border-t border-dashed border-[var(--color-line)] pt-3 font-mono text-xs text-[var(--color-ink-soft)] dark:border-neutral-700 dark:text-neutral-400">
          <div>
            <dt className="inline font-semibold">variables:</dt>{" "}
            <dd className="inline">
              {template.variables
                .map((v) =>
                  v.type === "choice"
                    ? `${v.name} ∈ {${v.values.join(", ")}}`
                    : `${v.name} ∈ [${v.min}, ${v.max}]`,
                )
                .join("; ")}
            </dd>
          </div>
          {template.constraints?.length ? (
            <div>
              <dt className="inline font-semibold">constraints:</dt>{" "}
              <dd className="inline">{template.constraints.join(" ∧ ")}</dd>
            </div>
          ) : null}
          {template.derived?.length ? (
            <div>
              <dt className="inline font-semibold">derived:</dt>{" "}
              <dd className="inline">
                {template.derived.map((d) => `${d.name} = ${d.expr}`).join("; ")}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="inline font-semibold">answer:</dt>{" "}
            <dd className="inline">
              {template.answer.value}
              {template.answer.unit ? ` [${template.answer.unit}]` : ""}
            </dd>
          </div>
          {template.options?.length ? (
            <div>
              <dt className="inline font-semibold">distractors:</dt>{" "}
              <dd className="inline">
                {template.options
                  .filter((o) => !o.correct)
                  .map((o) => o.expr)
                  .join("; ")}
              </dd>
            </div>
          ) : null}
        </dl>
      )}

      <p className="mt-3 font-mono text-[11px] text-[var(--color-ink-soft)] dark:text-neutral-500">
        {entry.id} · {entry.source}
      </p>
    </article>
  );
}
