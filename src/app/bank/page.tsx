"use client";

import { useCallback, useEffect, useState } from "react";
import { QuestionCard } from "@/components/QuestionCard";
import type { BankEntry, Syllabus } from "@/lib/types";

const PAGE_SIZE = 25;

export default function BankPage() {
  const [syllabus, setSyllabus] = useState<Syllabus | null>(null);
  const [entries, setEntries] = useState<BankEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [topicId, setTopicId] = useState("");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [showAnswers, setShowAnswers] = useState(true);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"paper" | "answers" | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/syllabus")
      .then((r) => r.json())
      .then((d) => setSyllabus(d.syllabus))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (topicId) params.set("topicId", topicId);
    if (kind) params.set("kind", kind);
    if (search.trim()) params.set("search", search.trim());
    const res = await fetch(`/api/questions?${params}`);
    const data = await res.json();
    setEntries(data.entries ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, [offset, topicId, kind, search]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    if (!confirm(`Delete ${id} from the bank? This cannot be undone.`)) return;
    await fetch(`/api/questions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  }

  async function exportBankPdf(withAnswers: boolean) {
    setExporting(withAnswers ? "answers" : "paper");
    setExportNotice(null);
    setExportError(null);
    try {
      const response = await fetch("/api/export/bank-pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topicId, kind, search, withAnswers }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `PDF export failed (${response.status}).`);
      }

      const disposition = response.headers.get("content-disposition") ?? "";
      const filename =
        disposition.match(/filename="([^"]+)"/)?.[1] ??
        (withAnswers ? "6091-bank-with-answers.pdf" : "6091-bank.pdf");
      const questionCount = response.headers.get("x-qg-question-count") ?? "matching";
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setExportNotice(
        `${questionCount} question${questionCount === "1" ? "" : "s"} downloaded and saved at output/pdf/${filename}`,
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Topic</span>
          <select
            value={topicId}
            onChange={(e) => { setTopicId(e.target.value); setOffset(0); }}
            className="rounded border border-[var(--color-line)] bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">All topics</option>
            {syllabus?.sections.flatMap((s) =>
              s.topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.number}. {t.title}
                </option>
              )),
            )}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">Kind</span>
          <select
            value={kind}
            onChange={(e) => { setKind(e.target.value); setOffset(0); }}
            className="rounded border border-[var(--color-line)] bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">All</option>
            <option value="static">Questions</option>
            <option value="template">Templates</option>
          </select>
        </label>

        <label className="flex-1 text-sm">
          <span className="mb-1 block font-medium">Search</span>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            placeholder="text in stem, answer, tags…"
            className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={showAnswers}
            onChange={(e) => setShowAnswers(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Show answers
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-line)] bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <button
          type="button"
          onClick={() => void exportBankPdf(false)}
          disabled={loading || total === 0 || kind === "template" || exporting !== null}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {exporting === "paper" ? "Building PDF…" : "Download filtered PDF"}
        </button>
        <button
          type="button"
          onClick={() => void exportBankPdf(true)}
          disabled={loading || total === 0 || kind === "template" || exporting !== null}
          className="rounded border border-[var(--color-line)] px-3 py-1.5 text-sm disabled:opacity-40 dark:border-neutral-700"
        >
          {exporting === "answers" ? "Building PDF…" : "PDF + answers"}
        </button>
        <span className="text-xs text-[var(--color-ink-soft)] dark:text-neutral-400">
          Exports all matching questions across every page; templates are excluded.
        </span>
      </div>

      {exportNotice && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {exportNotice}
        </div>
      )}
      {exportError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {exportError}
        </div>
      )}

      <p className="text-sm text-[var(--color-ink-soft)] dark:text-neutral-400">
        {loading ? "Loading…" : `${total} entr${total === 1 ? "y" : "ies"}`}
        {total > 0 && ` · showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}`}
      </p>

      {!loading && entries.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--color-line)] p-10 text-center text-sm text-[var(--color-ink-soft)] dark:border-neutral-800 dark:text-neutral-400">
          Nothing here yet. Load questions from the <a href="/import" className="text-[var(--color-accent)] underline">Import</a> page.
        </div>
      )}

      <div className="space-y-3">
        {entries.map((entry) => (
          <div key={entry.id} className="relative">
            <QuestionCard entry={entry} showAnswers={showAnswers} />
            <button
              type="button"
              onClick={() => remove(entry.id)}
              className="absolute right-3 top-3 rounded border border-[var(--color-line)] px-2 py-0.5 text-xs text-[var(--color-ink-soft)] hover:border-red-400 hover:text-red-600 dark:border-neutral-700"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="rounded border border-[var(--color-line)] px-3 py-1 text-sm disabled:opacity-40 dark:border-neutral-700"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="rounded border border-[var(--color-line)] px-3 py-1 text-sm disabled:opacity-40 dark:border-neutral-700"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
