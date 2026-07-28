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
