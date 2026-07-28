import type { BankEntry, Question, QuestionAsset, QuestionTemplate } from "@/lib/types";
import { assetUrl } from "@/lib/assets";

function Figures({ assets }: { assets: QuestionAsset[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {assets.map((asset) => (
        <figure key={asset.path} className="m-0 max-w-full">
          {/* Bank figures are arbitrary sizes from whatever parsed the paper, so
              next/image's required dimensions don't fit; a plain img is right. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetUrl(asset.path)}
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
        </figure>
      ))}
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
