"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  resolveKnowledgeMarkdownFileUrl,
  resolveKnowledgeMarkdownLink,
  type KnowledgeMarkdownFileRef,
} from "@/lib/knowledge-markdown";

interface KnowledgeMarkdownPreviewProps {
  sourceId: string;
  markdownFile?: KnowledgeMarkdownFileRef;
  files: KnowledgeMarkdownFileRef[];
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; markdown: string }
  | { status: "error"; message: string };

export function KnowledgeMarkdownPreview({
  sourceId,
  markdownFile,
  files,
}: KnowledgeMarkdownPreviewProps) {
  const [state, setState] = useState<PreviewState>({ status: "idle" });

  useEffect(() => {
    if (!markdownFile) {
      setState({ status: "idle" });
      return;
    }
    const file = markdownFile;

    const controller = new AbortController();
    setState({ status: "loading" });

    async function loadMarkdown() {
      try {
        const response = await fetch(file.url, {
          cache: "no-store",
          headers: { accept: "text/plain" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Preview request failed (${response.status}).`);
        }
        const markdown = await response.text();
        if (!controller.signal.aborted) setState({ status: "ready", markdown });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void loadMarkdown();
    return () => controller.abort();
  }, [markdownFile, sourceId]);

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-[var(--color-line)] dark:border-neutral-800">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide">Markdown preview</h3>
          <p className="mt-0.5 text-[11px] text-[var(--color-ink-soft)] dark:text-neutral-500">
            Formatted text, equations, tables, and manifest-backed figures
          </p>
        </div>
        {markdownFile && (
          <a
            href={markdownFile.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--color-accent)] hover:border-[var(--color-accent)] dark:border-neutral-700 dark:bg-neutral-900"
          >
            Open raw file
          </a>
        )}
      </header>

      {!markdownFile && (
        <p className="p-5 text-sm text-[var(--color-ink-soft)] dark:text-neutral-400">
          This source has no Markdown file to preview.
        </p>
      )}

      {markdownFile && state.status === "loading" && (
        <p className="p-5 text-sm text-[var(--color-ink-soft)] dark:text-neutral-400">
          Rendering Markdown…
        </p>
      )}

      {markdownFile && state.status === "error" && (
        <div className="m-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {state.message}
        </div>
      )}

      {markdownFile && state.status === "ready" && (
        <article className="max-h-[72vh] overflow-auto bg-white px-5 py-6 text-[15px] leading-7 dark:bg-neutral-900 sm:px-7">
          <ReactMarkdown
            skipHtml
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { trust: false, throwOnError: false }]]}
            components={{
              h1: ({ children }) => (
                <h1 className="mb-5 mt-8 border-b border-[var(--color-line)] pb-2 text-2xl font-semibold first:mt-0 dark:border-neutral-700">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="mb-3 mt-8 text-xl font-semibold first:mt-0">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="mb-2 mt-6 text-lg font-semibold first:mt-0">{children}</h3>
              ),
              h4: ({ children }) => (
                <h4 className="mb-2 mt-5 font-semibold first:mt-0">{children}</h4>
              ),
              p: ({ children }) => <p className="my-3">{children}</p>,
              ul: ({ children }) => <ul className="my-3 ml-6 list-disc space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="my-3 ml-6 list-decimal space-y-1">{children}</ol>,
              li: ({ children }) => <li className="pl-1">{children}</li>,
              blockquote: ({ children }) => (
                <blockquote className="my-4 border-l-4 border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-4 py-2 text-[var(--color-ink-soft)] dark:bg-neutral-800 dark:text-neutral-300">
                  {children}
                </blockquote>
              ),
              hr: () => <hr className="my-7 border-[var(--color-line)] dark:border-neutral-700" />,
              a: ({ href, children }) => {
                const resolved = href ? resolveKnowledgeMarkdownLink(href, files) : null;
                if (!resolved) {
                  return <span className="text-[var(--color-ink-soft)]">{children}</span>;
                }
                const opensNewTab = resolved.external || resolved.href.startsWith("/api/knowledge/");
                return (
                  <a
                    href={resolved.href}
                    target={opensNewTab ? "_blank" : undefined}
                    rel={opensNewTab ? "noopener noreferrer" : undefined}
                    className="text-[var(--color-accent)] underline decoration-[var(--color-accent)]/35 underline-offset-2 hover:decoration-current"
                  >
                    {children}
                  </a>
                );
              },
              img: ({ src, alt }) => {
                const resolved = typeof src === "string"
                  ? resolveKnowledgeMarkdownFileUrl(src, files, "image")
                  : null;
                if (!resolved) {
                  return (
                    <span className="my-3 block rounded border border-dashed border-[var(--color-line)] p-3 text-xs text-[var(--color-ink-soft)] dark:border-neutral-700 dark:text-neutral-400">
                      {alt ? `Unavailable figure: ${alt}` : "Unavailable figure"}
                    </span>
                  );
                }
                return (
                  <img
                    src={resolved}
                    alt={alt ?? "Extracted figure"}
                    loading="lazy"
                    decoding="async"
                    className="mx-auto my-5 max-h-[65vh] max-w-full rounded border border-[var(--color-line)] bg-white object-contain p-2 dark:border-neutral-700"
                  />
                );
              },
              table: ({ children }) => (
                <div className="my-5 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-[var(--color-line)] bg-neutral-100 px-3 py-2 font-semibold dark:border-neutral-700 dark:bg-neutral-800">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-[var(--color-line)] px-3 py-2 align-top dark:border-neutral-700">
                  {children}
                </td>
              ),
              pre: ({ children }) => (
                <pre className="my-4 overflow-x-auto rounded-lg bg-neutral-950 p-4 text-sm leading-6 text-neutral-100">
                  {children}
                </pre>
              ),
              code: ({ children, className }) => {
                const isBlock = Boolean(className) || String(children).includes("\n");
                return (
                  <code
                    className={
                      isBlock
                        ? `${className ?? ""} bg-transparent p-0 font-mono text-inherit`
                        : "rounded bg-neutral-100 px-1 py-0.5 font-mono text-[0.9em] dark:bg-neutral-800"
                    }
                  >
                    {children}
                  </code>
                );
              },
            }}
          >
            {state.markdown}
          </ReactMarkdown>
        </article>
      )}
    </section>
  );
}
