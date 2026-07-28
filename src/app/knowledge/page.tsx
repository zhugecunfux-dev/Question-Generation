"use client";

import { useEffect, useMemo, useState } from "react";

type KnowledgeFileKind = "markdown" | "json" | "image";
type KnowledgeSourceKind = "notes" | "exercise" | "reference";

interface KnowledgeFile {
  path: string;
  name: string;
  kind: KnowledgeFileKind;
  size: number;
  sha256: string;
  url: string;
}

interface KnowledgeTopic {
  id: string;
  number: number;
  title: string;
  sectionTitle: string;
  sourceCount: number;
}

interface KnowledgeSource {
  id: string;
  title: string;
  kind: KnowledgeSourceKind;
  topicId: string;
  importedAt: string;
  totalBytes: number;
  counts: {
    markdown: number;
    json: number;
    image: number;
  };
  files: KnowledgeFile[];
}

interface KnowledgeResponse {
  topics: KnowledgeTopic[];
  sources: KnowledgeSource[];
  error?: string;
}

const KIND_LABELS: Record<KnowledgeSourceKind, string> = {
  notes: "Notes",
  exercise: "Exercise",
  reference: "Reference",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function StatBadge({ count, label }: { count: number; label: string }) {
  return (
    <span className="rounded border border-[var(--color-line)] bg-white px-1.5 py-0.5 text-[11px] text-[var(--color-ink-soft)] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      <span className="font-mono font-semibold text-[var(--color-ink)] dark:text-neutral-200">{count}</span>{" "}
      {label}
    </span>
  );
}

function SourceCard({
  source,
  topic,
  selected,
  onSelect,
}: {
  source: KnowledgeSource;
  topic?: KnowledgeTopic;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-lg border bg-white p-4 text-left transition dark:bg-neutral-900 ${
        selected
          ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent-soft)] dark:ring-neutral-700"
          : "border-[var(--color-line)] hover:border-[var(--color-accent)] dark:border-neutral-800"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-accent)] dark:bg-neutral-800">
          {KIND_LABELS[source.kind]}
        </span>
        <span className="text-xs text-[var(--color-ink-soft)] dark:text-neutral-500">
          {formatDate(source.importedAt)}
        </span>
      </div>

      <h3 className="mt-2 break-words font-semibold">{source.title}</h3>
      <p className="mt-1 text-xs text-[var(--color-ink-soft)] dark:text-neutral-400">
        {topic ? `${topic.number}. ${topic.title}` : source.topicId} · {formatBytes(source.totalBytes)}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <StatBadge count={source.counts.markdown} label="Markdown" />
        <StatBadge count={source.counts.json} label="JSON" />
        <StatBadge count={source.counts.image} label="images" />
      </div>
    </button>
  );
}

function FileLink({ file }: { file: KnowledgeFile }) {
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-lg border border-[var(--color-line)] px-3 py-2.5 text-sm hover:border-[var(--color-accent)] dark:border-neutral-800"
    >
      <span className="w-9 shrink-0 rounded bg-[var(--color-accent-soft)] py-1 text-center font-mono text-[10px] font-semibold uppercase text-[var(--color-accent)] dark:bg-neutral-800">
        {file.kind === "markdown" ? "MD" : "JSON"}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium" title={file.name}>
        {file.name}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-[var(--color-ink-soft)] dark:text-neutral-500">
        {formatBytes(file.size)}
      </span>
    </a>
  );
}

export default function KnowledgePage() {
  const [data, setData] = useState<KnowledgeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTopicId, setActiveTopicId] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [showAllImages, setShowAllImages] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/knowledge");
        const body = (await response.json()) as KnowledgeResponse;
        if (!response.ok) {
          throw new Error(body.error ?? `Request failed (${response.status}).`);
        }
        if (!cancelled) {
          setData(body);
          setSelectedSourceId((current) =>
            current && body.sources.some((source) => source.id === current)
              ? current
              : (body.sources[0]?.id ?? ""),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const topicById = useMemo(
    () => new Map((data?.topics ?? []).map((topic) => [topic.id, topic] as const)),
    [data],
  );

  const topicGroups = useMemo(() => {
    const groups = new Map<string, KnowledgeTopic[]>();
    for (const topic of data?.topics ?? []) {
      const topics = groups.get(topic.sectionTitle) ?? [];
      topics.push(topic);
      groups.set(topic.sectionTitle, topics);
    }
    return Array.from(groups, ([sectionTitle, topics]) => ({ sectionTitle, topics }));
  }, [data]);

  const visibleSources = useMemo(
    () =>
      (data?.sources ?? []).filter(
        (source) => !activeTopicId || source.topicId === activeTopicId,
      ),
    [activeTopicId, data],
  );

  const selectedSource = data?.sources.find((source) => source.id === selectedSourceId);
  const activeTopic = activeTopicId ? topicById.get(activeTopicId) : undefined;
  const selectedFiles = selectedSource?.files.filter((file) => file.kind !== "image") ?? [];
  const selectedImages = selectedSource?.files.filter((file) => file.kind === "image") ?? [];
  const visibleImages = showAllImages ? selectedImages : selectedImages.slice(0, 12);
  const totalFiles =
    data?.sources.reduce(
      (total, source) =>
        total + source.counts.markdown + source.counts.json + source.counts.image,
      0,
    ) ?? 0;

  function chooseTopic(topicId: string) {
    setActiveTopicId(topicId);
    const nextSource = (data?.sources ?? []).find(
      (source) => !topicId || source.topicId === topicId,
    );
    setSelectedSourceId(nextSource?.id ?? "");
    setShowAllImages(false);
  }

  function chooseSource(sourceId: string) {
    setSelectedSourceId(sourceId);
    setShowAllImages(false);
  }

  return (
    <div className="space-y-7">
      <section>
        <h1 className="text-lg font-semibold">Knowledge base</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--color-ink-soft)] dark:text-neutral-400">
          OCR sources organised by the 6091 syllabus. Open the extracted Markdown or JSON files,
          or inspect the figures kept with each source.
        </p>
        {!loading && !error && data && (
          <p className="mt-2 font-mono text-[11px] text-[var(--color-ink-soft)] dark:text-neutral-500">
            {data.sources.length} source{data.sources.length === 1 ? "" : "s"} · {totalFiles} file
            {totalFiles === 1 ? "" : "s"}
          </p>
        )}
      </section>

      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="rounded border border-red-300 px-2 py-1 text-xs font-medium dark:border-red-800"
          >
            Try again
          </button>
        </div>
      )}

      {loading && (
        <div className="rounded-lg border border-dashed border-[var(--color-line)] p-10 text-center text-sm text-[var(--color-ink-soft)] dark:border-neutral-800 dark:text-neutral-400">
          Loading knowledge sources…
        </div>
      )}

      {!loading && !error && data && (
        <div className="grid gap-8 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside>
            <div className="space-y-4 lg:sticky lg:top-6">
              <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide">Topics</h2>
                <button
                  type="button"
                  onClick={() => chooseTopic("")}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm ${
                    !activeTopicId
                      ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)] dark:bg-neutral-800"
                      : "hover:bg-white dark:hover:bg-neutral-900"
                  }`}
                >
                  <span className="flex-1">All topics</span>
                  <span className="font-mono text-[11px] opacity-65">{data.sources.length}</span>
                </button>
              </div>

              {topicGroups.map((group) => (
                <section key={group.sectionTitle}>
                  <h3 className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-soft)] dark:text-neutral-500">
                    {group.sectionTitle}
                  </h3>
                  <div className="space-y-0.5">
                    {group.topics.map((topic) => (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() => chooseTopic(topic.id)}
                        className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
                          activeTopicId === topic.id
                            ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)] dark:bg-neutral-800"
                            : "hover:bg-white dark:hover:bg-neutral-900"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {topic.number}. {topic.title}
                        </span>
                        <span className="font-mono text-[11px] opacity-55">{topic.sourceCount}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </aside>

          <section className="min-w-0 space-y-6">
            <section>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-semibold">
                    {activeTopic ? `${activeTopic.number}. ${activeTopic.title}` : "All sources"}
                  </h2>
                  {activeTopic && (
                    <p className="mt-0.5 text-xs text-[var(--color-ink-soft)] dark:text-neutral-500">
                      {activeTopic.sectionTitle}
                    </p>
                  )}
                </div>
                <p className="text-xs text-[var(--color-ink-soft)] dark:text-neutral-500">
                  {visibleSources.length} source{visibleSources.length === 1 ? "" : "s"}
                </p>
              </div>

              {visibleSources.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--color-line)] p-8 text-center text-sm text-[var(--color-ink-soft)] dark:border-neutral-800 dark:text-neutral-400">
                  No sources have been added to this topic yet.
                </div>
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {visibleSources.map((source) => (
                    <SourceCard
                      key={source.id}
                      source={source}
                      topic={topicById.get(source.topicId)}
                      selected={source.id === selectedSourceId}
                      onSelect={() => chooseSource(source.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            {selectedSource && visibleSources.some((source) => source.id === selectedSource.id) && (
              <section className="rounded-xl border border-[var(--color-line)] bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
                      Selected source
                    </p>
                    <h2 className="mt-1 break-words text-lg font-semibold">{selectedSource.title}</h2>
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)] dark:text-neutral-400">
                      {topicById.get(selectedSource.topicId)
                        ? `${topicById.get(selectedSource.topicId)?.number}. ${topicById.get(selectedSource.topicId)?.title}`
                        : selectedSource.topicId}{" "}
                      · imported {formatDate(selectedSource.importedAt)} ·{" "}
                      {formatBytes(selectedSource.totalBytes)}
                    </p>
                  </div>
                  <span className="rounded bg-[var(--color-accent-soft)] px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-accent)] dark:bg-neutral-800">
                    {KIND_LABELS[selectedSource.kind]}
                  </span>
                </header>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  <StatBadge count={selectedSource.counts.markdown} label="Markdown" />
                  <StatBadge count={selectedSource.counts.json} label="JSON" />
                  <StatBadge count={selectedSource.counts.image} label="images" />
                </div>

                <div className="mt-6 grid gap-7 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                  <section>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">Extracted files</h3>
                    {selectedFiles.length > 0 ? (
                      <div className="space-y-2">
                        {selectedFiles.map((file) => (
                          <FileLink key={file.path} file={file} />
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-lg border border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-ink-soft)] dark:border-neutral-800 dark:text-neutral-400">
                        No Markdown or JSON files.
                      </p>
                    )}
                  </section>

                  <section>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold uppercase tracking-wide">Images</h3>
                      <span className="font-mono text-[11px] text-[var(--color-ink-soft)] dark:text-neutral-500">
                        {selectedImages.length}
                      </span>
                    </div>

                    {selectedImages.length > 0 ? (
                      <>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {visibleImages.map((file) => (
                            <a
                              key={file.path}
                              href={file.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group min-w-0 rounded-lg border border-[var(--color-line)] bg-neutral-50 p-1.5 hover:border-[var(--color-accent)] dark:border-neutral-800 dark:bg-neutral-950"
                            >
                              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded bg-white dark:bg-neutral-900">
                                <img
                                  src={file.url}
                                  alt={file.name}
                                  loading="lazy"
                                  className="h-full w-full object-contain transition group-hover:scale-[1.02]"
                                />
                              </div>
                              <p
                                className="mt-1.5 truncate px-0.5 text-[10px] text-[var(--color-ink-soft)] dark:text-neutral-500"
                                title={file.name}
                              >
                                {file.name}
                              </p>
                            </a>
                          ))}
                        </div>

                        {selectedImages.length > 12 && (
                          <button
                            type="button"
                            onClick={() => setShowAllImages((value) => !value)}
                            className="mt-3 rounded border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] hover:border-[var(--color-accent)] dark:border-neutral-700"
                          >
                            {showAllImages
                              ? "Show first 12"
                              : `Show all ${selectedImages.length} images`}
                          </button>
                        )}
                      </>
                    ) : (
                      <p className="rounded-lg border border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-ink-soft)] dark:border-neutral-800 dark:text-neutral-400">
                        No extracted images.
                      </p>
                    )}
                  </section>
                </div>
              </section>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
