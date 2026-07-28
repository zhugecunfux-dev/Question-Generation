import type { Metadata } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "6091 Question Generator",
  description: "Generate O-Level Physics (6091) questions from an existing question bank.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-[var(--color-line)] dark:border-neutral-800">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              6091 <span className="text-[var(--color-accent)]">Question Generator</span>
            </Link>
            <div className="flex flex-1 gap-5 text-sm text-[var(--color-ink-soft)] dark:text-neutral-400">
              <Link href="/" className="hover:text-[var(--color-accent)]">Generate</Link>
              <Link href="/bank" className="hover:text-[var(--color-accent)]">Question bank</Link>
              <Link href="/knowledge" className="hover:text-[var(--color-accent)]">Knowledge base</Link>
              <Link href="/import" className="hover:text-[var(--color-accent)]">Import</Link>
              <Link href="/agent" className="hover:text-[var(--color-accent)]">Codex</Link>
            </div>
            <LogoutButton />
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
      </body>
    </html>
  );
}
