# Progress

Status of the 6091 question generator, as of the branch
`claude/singapore-olevel-physics-generator-bdpnm0` /
[PR #1](https://github.com/zhugecunfux-dev/Question-Generation/pull/1).

**Where it stands:** the app works end to end on a starter bank, CI is green, and
the ingestion path from a parsed PDF into the bank is wired and tested. What it
has not yet met is a real question bank — every number below comes from 12 seed
entries and one synthetic paper.

---

## Done

### Syllabus model

`data/syllabus/6091-physics.json` — 6 sections, 20 topics, 71 sub-topics, the
three papers with durations/marks/weightings, and the AO weightings. Everything
keys off this one file: the topic picker, import validation, and the model's
system prompt.

> ⚠️ **Sub-topics are unverified.** The SEAB PDF could not be downloaded from the
> build environment (network policy blocks `seab.gov.sg` and its Isomer mirror).
> Section and topic structure and the scheme of assessment were cross-checked
> against public summaries; the 71 sub-topics are a reconstruction, flagged
> `"verified": false`. Diff against pages 10–22 of the official PDF before
> relying on them for coverage reporting.

### Three generation modes

| Mode | Status | Notes |
|---|---|---|
| Retrieve | Working | Filtered sampling from the bank; calls no model. |
| Template variants | Working | Seeded expansion; answers computed from the template's own expressions, not stored. |
| Codex-authored | Implemented locally | Reads matching bank examples, runs through the `/agent` Codex bridge without a provider API key, and requires at least 30% SVG figure questions. |

Codex-authored requests now open a dedicated live progress window. It separates
question writing from figure/layout work and reports bank context, Codex
drafting, validation, SVG storage, paper assembly, and completion from real
server-side events rather than an estimated timer.

Retrieve and template modes are seeded — the same seed always produces the same
paper. Verified by a 480-case sweep (see Verification).

### Template engine

Expressions are parsed by a hand-written tokenizer + Pratt parser
(`src/lib/template/expr.ts`), not `eval`, because templates are user-supplied
data. Supports `+ - * / % ^`, comparisons, boolean operators, a function
whitelist, and the constants `pi` / `e` / `g` (shadowable per template).

Variants are deduplicated by rendered stem, so a template whose variable space is
smaller than the requested count yields fewer questions **and warns**, rather
than silently repeating.

### Import

JSON array / JSONL / `{questions, templates}` wrapper / CSV, with field aliases
and loose casing. Invalid rows are **rejected and reported**, never silently
written or dropped: unknown `topicId`, an MCQ without exactly one key, a template
that will not expand, an unsafe or missing figure path. `--dry-run` and
`--skip-asset-check` cover the awkward cases.

### Figures (tiers 1 and 2)

Questions and templates carry `assets[]` — path, caption, alt text, dimensions.
Images live in `data/assets/` and are served by `/api/assets/[...path]` rather
than from `public/`, so path containment is enforced in one place. Traversal,
absolute paths, drive letters, `file://` and `data:` URLs, NUL bytes, and
symlinks escaping the root are all rejected; SVGs are served under a `sandbox`
CSP because a bank SVG can carry script.

`npm run describe-assets` fills missing `alt` with Claude vision, prompted to
record what is *drawn* rather than to solve the question. `alt` is searchable
metadata, accessibility text, and few-shot context — deliberately **not** a
substitute for the image.

### Ingestion pipeline

`npm run stage` normalises any parser's output (MinerU, Marker, Docling,
PyMuPDF4LLM) into the `assets[].path` shape: walks the tree, picks the largest
Markdown file, renumbers figures into reading order, copies them to
`data/assets/<paper-id>/`, and repoints the image references.

`docs/ingestion.md` covers the cost analysis and figure strategy;
`tools/parse/README.md` has the parser commands and measurements.

### Private Codex workspace

`/agent` is a browser chat workspace backed by a server-side
`codex app-server` process. It streams replies and activity, persists and
resumes Codex threads, supports stop/interrupt and approval decisions, and keeps
the Codex process and login credentials out of the browser.

The bridge is locked to `CODEX_WORKSPACE`, uses `workspace-write` plus
`on-request` approvals, and does not expose a general shell endpoint. A shared
`QG_ACCESS_TOKEN` protects the entire site with an HTTP-only cookie. The
devcontainer publishes port 3000 privately for a personal GitHub Codespaces
preview; a trusted always-on host or private network is still required for a
persistent deployment.

### Supporting pieces

- CI (`.github/workflows/ci.yml`): typecheck, test, build, seed-bank dry-run import.
- `npm run token-cost` — measures a document as PDF vs extracted text vs structured JSON.
- Interactive preview artifact — the same UI with the engine ported to the browser.

---

## Verification

What has actually been run, as opposed to written:

| Check | Result |
|---|---|
| Test suite | 51 tests, all passing (expr 6, engine 7, import 6, assets 9, stage 11, access 6, Codex 6) |
| `tsc --noEmit` | Clean |
| `next build` | Clean |
| Codex bridge live smoke | Access gate passed, App Server ready through ChatGPT login with child-secret isolation, `HARDENED_OK` streamed, thread listed and read back |
| CI on a clean checkout | Green in 43 s, all 8 steps |
| Browser-vs-server engine parity | 480 cases, 1296 questions, **0 mismatches** |
| Asset route path traversal | 5 attack shapes, all rejected against a live server, no content leaked |
| UI behaviour | 9 Playwright checks (seeding, filters, export, theme override) |
| Physics spot-checks | Every seed answer and a sample of generated variants recomputed by hand |
| PDF parsing | PyMuPDF4LLM on a synthetic paper: 0.45 s, figure uncropped, table recovered |

**Not verified end to end:** a live Codex-authored paper still requires an
interactive local Codex login. Its JSON parsing, question rules, detailed SVG
prompt requirement, and SVG safety rejection are covered by tests. The
`token-cost` counting branch and `describe-assets` still need an Anthropic API
key and were not exercised.

### Bugs found by these checks

Three worth recording, because each was invisible without the corresponding test:

1. **Prototype-chain leak in the expression evaluator.** `"constructor" in CONSTANTS`
   walks `Object.prototype`, so an expression could resolve `constructor` to a
   real host function and call it. Fixed with null-prototype maps and
   `hasOwnProperty`. Caught by a test that asserted unsafe identifiers throw.
2. **Wrong collation in the browser port.** The preview used `localeCompare`
   where SQLite uses BINARY, which would have desynced the seeded shuffle and
   made the preview generate different papers than the app. Caught by the parity
   sweep.
3. **Arg-parsing bug in `token-cost`.** With no `--model` flag, `indexOf` returns
   −1 and the "skip the model value" index computed to 0, silently swallowing the
   first filename.

Also worth knowing: `get_check_runs` on the GitHub API served a stale
`in_progress` for ~7 minutes after the job had finished. The workflow-jobs
endpoint had the truth.

---

## Open

### Blocking a real trial

- **No real question bank.** Everything is exercised against 12 seed entries.
  The first import of an actual Ten-Year-Series export is the real test of the
  field aliases and the validation rules.
- **MinerU output needs a human quality check.** MinerU 3.4.4 completed the
  supplied 27-page scanned `Kinematics.pdf` and emitted Markdown, JSON, and 89
  extracted JPEGs. The assistant intentionally did not inspect the note content,
  as requested. Hugging Face downloads worked; ModelScope was slow, and a local
  GPU-driver mismatch forced the CPU path.
- **The Codex-authored path needs a signed-in local Codex session.** Run
  `npm run codex:login`; no provider API key is required for question generation.

### Known gaps

- **Template figures, tier 3** — Codex-authored questions can now emit standalone
  SVG figures with detailed production prompts, but a parameterised template
  still cannot regenerate its figure from sampled variables.
- **Paper 3 (practical)** is modelled in the syllabus but not generated; AO3
  needs real apparatus.
- **`describe-assets` skips SVG** — not a vision input type, and rasterising
  needs a renderer this repo does not ship.
- **No figure deduplication** — the same figure reused across papers is stored
  per path, with no content hashing.
- **Single-tenant** — one shared access key protects the site, but there are no
  individual accounts, roles, or per-user thread boundaries.

### Deployment boundary

GitHub stores and reviews the source, but GitHub Pages cannot run this app: it
needs a persistent Node process, SQLite, and a local Codex App Server. Codespaces
is suitable for private testing from another computer but stops when idle. A
trusted always-on computer or VPS behind a private network is the persistent
option.

---

## Suggested next step

First, have the owner sample the MinerU Markdown and figures for OCR quality
without committing copyrighted notes. Then import one real past paper end to end
— stage the figures, structure it, and load it. That pass will exercise the
import aliases, asset validation, and syllabus tagging against real scanned
material.
