"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not sign in.");
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-[var(--color-line)] bg-white p-7 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-accent)] text-lg font-semibold text-white">
          60
        </div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Private workspace
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">6091 Physics Studio</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)] dark:text-neutral-400">
          Enter the private access key configured on the host computer. After verification, the
          browser receives only an HTTP-only session cookie.
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="block text-sm font-medium">
            Access key
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2.5 outline-none transition focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)] dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "Checking…" : "Open workspace"}
          </button>
        </form>
      </section>
    </main>
  );
}
