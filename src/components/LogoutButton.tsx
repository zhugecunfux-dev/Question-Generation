"use client";

import { useState } from "react";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    window.location.assign("/login");
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-accent)] disabled:opacity-50 dark:text-neutral-500"
    >
      {busy ? "Closing…" : "Lock"}
    </button>
  );
}
