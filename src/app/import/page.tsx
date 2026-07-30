"use client";

import { useState } from "react";

interface ImportResponse {
  dryRun: boolean;
  parsed: number;
  written: number;
  rejected: number;
  issues: Array<{ index: number; id?: string; message: string }>;
  truncatedIssues: number;
  error?: string;
}

const SAMPLE = `[
  {
    "id": "demo-1",
    "topicId": "T2",
    "format": "mcq",
    "difficulty": "easy",
    "ao": "AO2",
    "marks": 1,
    "stem": "A cyclist travels 120 m in 15 s at constant speed. What is the speed?",
    "options": [
      { "label": "A", "text": "0.13 m/s", "correct": false },
      { "label": "B", "text": "8.0 m/s", "correct": true },
      { "label": "C", "text": "105 m/s", "correct": false },
      { "label": "D", "text": "1800 m/s", "correct": false }
    ],
    "answer": "B (8.0 m/s)",
    "solution": "speed = distance / time = 120 / 15 = 8.0 m/s",
    "tags": "demo"
  }
]`;

export default function ImportPage() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const url = `/api/import${dryRun ? "?dryRun=1" : ""}`;
      let res: Response;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        res = await fetch(url, { method: "POST", body: form });
      } else {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: text,
        });
      }
      const data = (await res.json()) as ImportResponse;
      if (!res.ok) setError(data.error ?? `Request failed (${res.status}).`);
      else setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <section>
        <h1 className="text-lg font-semibold">Import questions</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)] dark:text-neutral-400">
          Accepts a JSON array, JSONL, a <code>{"{questions: [...]}"}</code> wrapper, or CSV. Rows are
          validated against the 6091 syllabus — an unknown <code>topicId</code>, an MCQ without exactly
          one key, or a template that will not expand is rejected and reported rather than written.
          Run a dry run first on any new export format.
        </p>
      </section>

      <section className="space-y-2">
        <label className="block text-sm font-medium">Upload a file</label>
        <input
          type="file"
          accept=".json,.jsonl,.csv,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
        {file && (
          <p className="text-xs text-[var(--color-ink-soft)]">
            {file.name} ({Math.ceil(file.size / 1024)} KB) — paste box ignored while a file is selected.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium">…or paste directly</label>
          <button
            type="button"
            onClick={() => { setText(SAMPLE); setFile(null); }}
            className="text-xs text-[var(--color-accent)] underline"
          >
            Insert sample
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          spellCheck={false}
          placeholder={SAMPLE}
          className="w-full rounded border border-[var(--color-line)] bg-white p-3 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
      </section>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={busy || (!text.trim() && !file)}
          className="rounded-md border border-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent)] disabled:opacity-50"
        >
          Dry run
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={busy || (!text.trim() && !file)}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Import"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3 rounded-md border border-[var(--color-line)] bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p className="font-medium">
            {result.dryRun ? "Dry run — nothing written." : `Imported ${result.written} entr${result.written === 1 ? "y" : "ies"}.`}
          </p>
          <p>
            Parsed {result.parsed} valid · rejected {result.rejected}
          </p>
          {result.issues.length > 0 && (
            <div>
              <p className="mb-1 font-medium">Rejected rows</p>
              <ul className="max-h-72 space-y-0.5 overflow-y-auto font-mono text-xs text-red-800 dark:text-red-300">
                {result.issues.map((issue, i) => (
                  <li key={i}>
                    row {issue.index}
                    {issue.id ? ` (${issue.id})` : ""}: {issue.message}
                  </li>
                ))}
              </ul>
              {result.truncatedIssues > 0 && (
                <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                  …and {result.truncatedIssues} more.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
