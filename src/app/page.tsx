"use client";

import { useEffect, useMemo, useState } from "react";
import { QuestionCard } from "@/components/QuestionCard";
import { GenerationProgressPanel } from "@/components/GenerationProgressPanel";
import type { GenerationProgress } from "@/lib/generation-progress";
import type { Difficulty, GeneratedPaper, QuestionFormat, Syllabus } from "@/lib/types";

type Mode = "retrieve" | "template" | "llm";

const MODE_HELP: Record<Mode, string> = {
  retrieve: "Pick existing questions straight from the bank. Nothing is invented — safest for a graded paper.",
  template: "Expand parameterised templates into fresh number variants. Answers are computed, not guessed.",
  llm: "Have your local Codex read matching bank questions and write new ones. At least 30% include generated SVG figures.",
};

const FORMATS: QuestionFormat[] = ["mcq", "structured", "data_based", "free_response"];
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export default function GeneratePage() {
  const [syllabus, setSyllabus] = useState<Syllabus | null>(null);
  const [counts, setCounts] = useState<Array<{ topicId: string; kind: string; n: number }>>([]);

  const [mode, setMode] = useState<Mode>("retrieve");
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [formats, setFormats] = useState<QuestionFormat[]>(["mcq"]);
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [count, setCount] = useState(10);
  const [seed, setSeed] = useState("");
  const [notes, setNotes] = useState("");
  const [save, setSave] = useState(false);

  const [paper, setPaper] = useState<GeneratedPaper | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"paper" | "answers" | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] =
    useState<GenerationProgress | null>(null);

  useEffect(() => {
    fetch("/api/syllabus")
      .then((r) => r.json())
      .then((d) => {
        setSyllabus(d.syllabus);
        setCounts(d.counts);
      })
      .catch(() => setError("Could not load the syllabus."));
  }, []);

  const countFor = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of counts) map.set(c.topicId, (map.get(c.topicId) ?? 0) + c.n);
    return map;
  }, [counts]);

  function toggle<T>(list: T[], value: T, set: (v: T[]) => void) {
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  async function generate() {
    if (topicIds.length === 0) {
      setError("Pick at least one topic.");
      return;
    }
    setBusy(true);
    setError(null);
    setPaper(null);
    setExportNotice(null);
    setGenerationProgress(null);
    const progressWindow =
      mode === "llm" ? window.open("about:blank", "qg-codex-generation") : null;
    let codexThreadStarted = false;
    let progressTimer: number | undefined;
    let progressThreadId: string | undefined;

    const refreshProgress = async () => {
      if (!progressThreadId) return;
      const response = await fetch(
        `/api/generation-progress?threadId=${encodeURIComponent(progressThreadId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = (await response.json()) as { progress: GenerationProgress };
      setGenerationProgress(data.progress);
    };

    try {
      let codexThreadId: string | undefined;
      if (mode === "llm") {
        const threadResponse = await fetch("/api/codex", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        });
        const threadData = (await threadResponse.json()) as {
          thread?: { id?: string };
          error?: string;
        };
        if (!threadResponse.ok || !threadData.thread?.id) {
          throw new Error(threadData.error ?? "Could not start the local Codex generation thread.");
        }
        codexThreadId = threadData.thread.id;
        progressThreadId = codexThreadId;
        codexThreadStarted = true;
        if (progressWindow) {
          progressWindow.location.href = `/progress?threadId=${encodeURIComponent(codexThreadId)}`;
        }
        progressTimer = window.setInterval(() => void refreshProgress(), 900);
      }
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          topicIds,
          formats: formats.length ? formats : undefined,
          difficulties: difficulties.length ? difficulties : undefined,
          count,
          seed: seed.trim() === "" ? undefined : Number(seed),
          notes: notes.trim() || undefined,
          codexThreadId,
          save: mode === "llm" ? save : false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status}).`);
        setPaper(null);
      } else {
        setPaper(data as GeneratedPaper);
      }
    } catch (err) {
      if (!codexThreadStarted) progressWindow?.close();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (progressTimer !== undefined) window.clearInterval(progressTimer);
      await refreshProgress().catch(() => undefined);
      setBusy(false);
    }
  }

  async function exportPaper(withAnswers: boolean) {
    if (!paper) return;
    setExporting(withAnswers ? "answers" : "paper");
    setError(null);
    setExportNotice(null);
    try {
      const response = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paper, withAnswers }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `PDF export failed (${response.status}).`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename =
        disposition.match(/filename="([^"]+)"/)?.[1] ??
        (withAnswers ? "6091-paper-with-answers.pdf" : "6091-paper.pdf");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setExportNotice(`PDF downloaded and saved locally at output/pdf/${filename}`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[340px_1fr]">
      <aside className="space-y-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide">Generation mode</h2>
          <div className="space-y-1">
            {(["retrieve", "template", "llm"] as Mode[]).map((m) => (
              <label
                key={m}
                className={`block cursor-pointer rounded-md border p-2.5 text-sm ${
                  mode === m
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] dark:bg-neutral-800"
                    : "border-[var(--color-line)] dark:border-neutral-800"
                }`}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input
                    type="radio"
                    checked={mode === m}
                    onChange={() => setMode(m)}
                    className="accent-[var(--color-accent)]"
                  />
                  {m === "retrieve" ? "Retrieve from bank" : m === "template" ? "Template variants" : "Codex-authored"}
                </span>
                <span className="mt-1 block pl-6 text-xs text-[var(--color-ink-soft)] dark:text-neutral-400">
                  {MODE_HELP[m]}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide">Topics</h2>
          {!syllabus && <p className="text-sm text-[var(--color-ink-soft)]">Loading…</p>}
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {syllabus?.sections.map((section) => (
              <div key={section.id}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-soft)] dark:text-neutral-400">
                  {section.id}. {section.title}
                </p>
                {section.topics.map((topic) => (
                  <label key={topic.id} className="flex items-center gap-2 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      checked={topicIds.includes(topic.id)}
                      onChange={() => toggle(topicIds, topic.id, setTopicIds)}
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="flex-1">
                      {topic.number}. {topic.title}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--color-ink-soft)] dark:text-neutral-500">
                      {countFor.get(topic.id) ?? 0}
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setTopicIds(
                topicIds.length ? [] : (syllabus?.sections.flatMap((s) => s.topics.map((t) => t.id)) ?? []),
              )
            }
            className="mt-2 text-xs text-[var(--color-accent)] underline"
          >
            {topicIds.length ? "Clear all" : "Select all"}
          </button>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide">Filters</h2>
          <p className="mb-1 text-xs text-[var(--color-ink-soft)] dark:text-neutral-400">Format</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => toggle(formats, f, setFormats)}
                className={`rounded border px-2 py-1 text-xs ${
                  formats.includes(f)
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] dark:bg-neutral-800"
                    : "border-[var(--color-line)] dark:border-neutral-700"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <p className="mb-1 text-xs text-[var(--color-ink-soft)] dark:text-neutral-400">
            Difficulty (blank = any)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggle(difficulties, d, setDifficulties)}
                className={`rounded border px-2 py-1 text-xs ${
                  difficulties.includes(d)
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] dark:bg-neutral-800"
                    : "border-[var(--color-line)] dark:border-neutral-700"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Number of questions</span>
            <input
              type="number"
              min={1}
              max={60}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          {mode !== "llm" && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                Seed <span className="font-normal text-[var(--color-ink-soft)]">(blank = random)</span>
              </span>
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="e.g. 20260728"
                className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
          )}

          {mode === "llm" && (
            <>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Extra instruction</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g. focus on energy stores and transfers; avoid projectile motion"
                  className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={save}
                  onChange={(e) => setSave(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                Save generated questions to the bank
              </label>
            </>
          )}

          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="w-full rounded-md bg-[var(--color-accent)] px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {busy ? (mode === "llm" ? "Generating in Codex…" : "Generating…") : "Generate paper"}
          </button>
        </section>
      </aside>

      <section>
        {generationProgress && (
          <GenerationProgressPanel progress={generationProgress} compact />
        )}

        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}

        {!paper && !error && !generationProgress && (
          <div className="rounded-lg border border-dashed border-[var(--color-line)] p-10 text-center text-sm text-[var(--color-ink-soft)] dark:border-neutral-800 dark:text-neutral-400">
            Pick topics on the left and generate a paper.
          </div>
        )}

        {paper && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-line)] bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
              <span>
                <strong>{paper.questions.length}</strong> questions ·{" "}
                <strong>{paper.totalMarks}</strong> marks
              </span>
              {paper.seed !== undefined && (
                <span className="font-mono text-xs text-[var(--color-ink-soft)] dark:text-neutral-400">
                  seed {paper.seed}
                </span>
              )}
              {paper.codexThreadId && (
                <a
                  href={`/agent?threadId=${encodeURIComponent(paper.codexThreadId)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[var(--color-accent)] underline"
                >
                  Open Codex generation
                </a>
              )}
              <label className="ml-auto flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showAnswers}
                  onChange={(e) => setShowAnswers(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                Show answers
              </label>
              <button
                type="button"
                onClick={() => void exportPaper(false)}
                disabled={exporting !== null}
                className="rounded border border-[var(--color-line)] px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
              >
                {exporting === "paper" ? "Building PDF…" : "Download PDF"}
              </button>
              <button
                type="button"
                onClick={() => void exportPaper(true)}
                disabled={exporting !== null}
                className="rounded border border-[var(--color-line)] px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
              >
                {exporting === "answers" ? "Building PDF…" : "PDF + answers"}
              </button>
            </div>

            {exportNotice && (
              <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                {exportNotice}
              </div>
            )}

            {paper.warnings.length > 0 && (
              <ul className="mb-4 space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {paper.warnings.map((w, i) => (
                  <li key={i}>· {w}</li>
                ))}
              </ul>
            )}

            <div className="space-y-3">
              {paper.questions.map((q, i) => (
                <QuestionCard key={q.id} entry={q} index={i + 1} showAnswers={showAnswers} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
