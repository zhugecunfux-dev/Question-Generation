# 6091 Question Generator

A web app that generates Singapore-Cambridge GCE O-Level **Physics 6091** questions from an
existing question bank. Three generation modes, one syllabus model, one bank.

| Mode | What it does | When to use it |
|---|---|---|
| **Retrieve** | Picks existing questions from the bank, filtered by topic / format / difficulty. | Graded papers — nothing is invented. |
| **Template variants** | Expands parameterised templates into fresh number variants. Answers are *computed* from the template's own expressions. | Drill and homework sets; every student gets different numbers, same physics. |
| **Codex-authored** | Uses your local Codex login to read matching bank examples and write new questions; at least 30% include generated SVG figures. | New local practice sets that remain visible in the Codex workspace. |

Papers are reproducible: retrieve and template modes take a **seed**, so the same seed always
produces the same paper.

## Quick start

```bash
npm install
npm run import -- data/questions/seed.json   # load the starter bank (12 entries)
QG_INSECURE_LOCAL_ONLY=1 npm run dev          # http://localhost:3000
```
The local bypass is explicit and `npm run dev` binds to `127.0.0.1`.
Never use `QG_INSECURE_LOCAL_ONLY` with a remotely reachable server.


For Codex-authored mode, sign in once with `npm run codex:login`. It uses the
local Codex app-server and does not require an OpenAI Platform or Anthropic API
key. (`ANTHROPIC_API_KEY` remains optional for the separate `token-cost` and
`describe-assets` utilities.)

Retrieve and template modes work without a key.

```bash
npm test        # 51 tests: core engine, importer, assets, staging, access, and Codex bridge
npm run build   # production build
```

## Private Codex workspace

The **Codex** page is a private, server-side bridge to your local Codex login. It can
start or resume Codex conversations, stream replies and activity, stop an active turn,
and ask before commands or file changes. The browser never receives your ChatGPT
credentials, and no OpenAI Platform API key is required.

Codex file writes are locked to this repository with the `workspace-write` sandbox.
The whole site fails closed unless `QG_ACCESS_TOKEN` is configured for remote use,
because the import, delete, and agent routes all change local data. The sandbox is not
a secrecy boundary for files the host OS account can already read: prefer an isolated
Codespace/container or a dedicated OS account, and treat the access key as sensitive
as access to that host.

### Run on a trusted computer

First sign Codex in with the ChatGPT account whose subscription you want to use:

```bash
npm run codex:login
```

Then run the site. Use a long private value and open `/agent` from your browser:

```bash
npm run build
QG_ACCESS_TOKEN=choose-a-long-random-value \
CODEX_WORKSPACE="$PWD" \
npm run start:remote
```

Do not publish port 3000 directly to the public internet. Put it behind Tailscale,
another private VPN, or an HTTPS reverse proxy with authentication. The host computer
must remain awake and online.

### Open it from another computer with GitHub Codespaces

This repository includes a dev-container configuration. Create a Codespace from this
branch, then run:

```bash
export QG_ACCESS_TOKEN=choose-a-long-random-value
npm run codex:login
npm run dev:remote
```

Open the private forwarded port **3000** from the Codespaces **Ports** panel. Sign in to
GitHub from the other computer and open the same private port URL. Codespaces stop when
idle and may incur GitHub compute/storage charges; the Codex model usage still follows
the ChatGPT account used by `codex login`.

Conversation history is stored by Codex on the host that runs the app. SQLite question
data also lives on that host. GitHub stores the source code, not the live database or
Codex login. GitHub Pages and ordinary serverless hosting cannot run this application
because it needs a persistent Node process, SQLite, and a local Codex child process.

Two helper scripts need an API key:

```bash
npm run token-cost -- source/paper.pdf parsed/paper.md   # what a source doc costs, three ways
npm run describe-assets -- --dry-run                     # fill in missing figure descriptions
```

## Private knowledge base

The **Knowledge base** page groups OCR source bundles by the existing 6091 syllabus
topics. Original Markdown, MinerU JSON sidecars, and extracted images stay on the
host under `data/knowledge/`; SQLite stores only their searchable metadata and file
manifest. The private directory is Git-ignored because this repository is public.

Import one completed MinerU `ocr/` directory with an explicit topic and material type:

```bash
npm run knowledge:import -- \
  --in "../notes/mineru-output/Kinematics/ocr" \
  --topic-id T2 \
  --id kinematics-notes \
  --title "Kinematics Notes" \
  --kind notes
```

The importer accepts exactly one Markdown file, top-level JSON sidecars, and
JPG/PNG/WebP/GIF files inside `images/`. Parser-generated PDFs are excluded. Files
are hashed, JSON is validated, symbolic links and unsafe paths are rejected, and an
identical re-import is a no-op. Knowledge files are served only through authenticated
`private, no-store` routes. The browser preview supports GFM tables and KaTeX equations;
raw HTML and trusted KaTeX commands stay disabled, while relative figures resolve only
to image files recorded in that source's manifest.

Set `QG_KNOWLEDGE_DIR` to move the private file root. Neither the knowledge files nor
their SQLite index travel with a Git clone or a new Codespace, so back them up
separately. Codex-authored generation now retrieves bounded, topic-matched excerpts from
the canonical Markdown in these sources. Exercise excerpts act as few-shot style
references; notes and reference excerpts provide factual grounding. Every file is
rechecked against its manifest size and SHA-256 before retrieval, and OCR text is
framed as untrusted data. MinerU JSON sidecars and source image bytes are not sent
to the current text-only Codex turn.

Selected excerpts are sent to the Codex service and remain visible in the dedicated
generation thread. Generation uses a fresh read-only, no-approval turn; do not reuse
an everyday `/agent` conversation for private Knowledge Base generation.

## Getting papers in

`npm run stage` takes a PDF parser's output (MinerU, Marker, Docling, PyMuPDF4LLM),
copies the extracted figures into `data/assets/<paper-id>/`, and rewrites the Markdown
image references to the form `assets[].path` expects:

```bash
npm run stage -- --in out/6091_2019_p2 --paper-id tys2019-p2
```

Parser commands, how to tell a digital PDF from a scan in one line, and measured
timings are in [`tools/parse/README.md`](tools/parse/README.md). The full pipeline,
cost analysis, and figure strategy are in [`docs/ingestion.md`](docs/ingestion.md).

## Syllabus model

[`data/syllabus/6091-physics.json`](data/syllabus/6091-physics.json) encodes the 6 sections,
20 topics, sub-topics, the three papers, and the AO weightings. Everything else keys off it:
the topic picker, import validation, and the LLM system prompt all read from this one file.
See [`docs/syllabus-6091.md`](docs/syllabus-6091.md) for the human-readable version, the
scheme of assessment, and the 2024 revision changes.

> **Verification status:** the SEAB PDF could not be downloaded from the environment this was
> built in (network policy blocks `seab.gov.sg`). Section/topic structure and the scheme of
> assessment were cross-checked against public summaries; **sub-topic breakdowns are a
> reconstruction** and are marked `"verified": false` in the JSON. Diff them against pages
> 10–22 of the official PDF before relying on them for coverage reporting.

## Loading your question bank

Import accepts a **JSON array**, **JSONL**, a `{"questions": [...], "templates": [...]}`
wrapper, or **CSV** — via the `/import` page, the CLI, or `POST /api/import`.

Rows are validated against the syllabus. An unknown `topicId`, an MCQ without exactly one key,
or a template that will not expand is **rejected and reported**, not silently written. Run a
dry run first on any new export format:

```bash
npm run import -- --dry-run my-export.csv
```

### Static question

Field aliases are accepted (`question`/`text`/`body` for `stem`, `topic`/`topic_id` for
`topicId`; `T3`, `3` and `Topic 03` all normalise to `T3`).

```json
{
  "id": "tys2019-p1-q4",
  "topicId": "T2",
  "subtopicId": "T2.2",
  "format": "mcq",
  "difficulty": "easy",
  "ao": "AO2",
  "marks": 1,
  "stem": "A cyclist travels 120 m in 15 s at constant speed. What is the speed?",
  "options": [
    { "label": "A", "text": "0.13 m/s", "correct": false },
    { "label": "B", "text": "8.0 m/s",  "correct": true  },
    { "label": "C", "text": "105 m/s",  "correct": false },
    { "label": "D", "text": "1800 m/s", "correct": false }
  ],
  "answer": "B (8.0 m/s)",
  "solution": "speed = distance / time = 120 / 15 = 8.0 m/s",
  "tags": "TYS2019,kinematics"
}
```

`format` is one of `mcq`, `structured`, `data_based`, `free_response`, `practical`;
`difficulty` is `easy`/`medium`/`hard`; `ao` is `AO1`/`AO2`/`AO3`.

### Template

```json
{
  "kind": "template",
  "id": "tpl-T2-accel",
  "topicId": "T2",
  "format": "mcq",
  "difficulty": "easy",
  "ao": "AO2",
  "marks": 1,
  "stem": "A car speeds up uniformly from {{u}} m/s to {{v}} m/s in {{t}} s. What is its acceleration?",
  "variables": [
    { "name": "u", "type": "int", "min": 2,  "max": 14, "step": 2 },
    { "name": "v", "type": "int", "min": 16, "max": 40, "step": 2 },
    { "name": "t", "type": "int", "min": 2,  "max": 10 }
  ],
  "constraints": ["v > u"],
  "derived": [{ "name": "a", "expr": "(v - u) / t", "sigfig": 3 }],
  "answer": { "value": "a", "unit": "m/s^2", "sigfig": 3 },
  "options": [
    { "expr": "(v - u) / t", "correct": true },
    { "expr": "(v + u) / t" },
    { "expr": "v / t" },
    { "expr": "(v - u) * t" }
  ],
  "solution": "a = (v - u)/t = ({{v}} - {{u}})/{{t}} = {{a}} m/s^2"
}
```

- **Variable types:** `int` (`min`, `max`, `step`), `float` (`min`, `max`, `decimals`),
  `choice` (`values`).
- **`constraints`** are boolean expressions; a draw that fails them is resampled.
- **`derived`** values are computed in order and can reference earlier ones.
- **Distractors** should encode real student errors (wrong rearrangement, unit slip, sign
  error). Distractors that collide numerically with the key are dropped automatically.
- **Rounding:** `sigfig` or `decimals` on `answer` and on each `derived` entry.
- Variants are deduplicated by rendered stem, so a template whose variable space is smaller
  than the requested count yields fewer questions **and warns**, rather than repeating itself.

Expressions support `+ - * / % ^`, comparisons, `&& || !`, and a whitelist of functions
(`sqrt`, `sin`/`cos`/`tan`, `sind`/`cosd`/`tand`, `ln`, `log`, `exp`, `abs`, `round`, `min`,
`max`, `hypot`, `floor`, `ceil`, …) plus the constants `pi`, `e`, and `g` (9.81 — shadowable
per template). They are parsed by a hand-written tokenizer + Pratt parser in
[`src/lib/template/expr.ts`](src/lib/template/expr.ts) — **not** `eval` — because templates are
user-supplied data.

### Figures

6091 is figure-heavy, so questions and templates take an optional `assets` array.
Images live in `data/assets/` (override with `QG_ASSETS_DIR`) and are served by
`/api/assets/[...path]`, which enforces path containment in one place.

```json
"assets": [
  {
    "path": "seed/velocity-time-trolley.svg",
    "caption": "Fig. 2.1",
    "alt": "Velocity-time graph. Velocity rises linearly from 0 to 20 m/s over the first 5 s, then stays constant at 20 m/s until 10 s.",
    "width": 440,
    "height": 300
  }
]
```

`alt` is searchable metadata, accessibility text, and context when few-shotting
the model — deliberately **not** a substitute for the image. Generate missing
ones with `npm run describe-assets`.

An unsafe, non-image, or missing path is rejected like any other invalid row.
Pass `--skip-asset-check` when the question JSON arrives before the images do.

> **Templates and figures are in tension.** If a template varies a number that
> is printed on its figure, the figure is wrong the moment it changes. Keep
> varying quantities in the stem and label the figure symbolically, or leave the
> question static. See [`docs/ingestion.md`](docs/ingestion.md).

## Codex-authored questions

`generateWithLlm` now sends the request to the same local Codex app-server used
by `/agent`. The generator creates a visible Codex thread, passes up to 30
matching examples from the local bank, the allowed syllabus topics, and the
required JSON contract. No provider API key is used.

Generate also opens `/progress` in a separate window. It reports real backend
stages for bank reading, Codex drafting, question validation, SVG safety checks,
asset storage, paper assembly, and optional bank saving. The same progress card
remains visible on the Generate page, while the raw Codex thread is available
from a link in the progress window.

Exactly the requested number of questions must pass validation. At least 30%
(rounded up) must include a self-contained SVG. Each figure carries a detailed
`generationPrompt` production brief, precise alt text, dimensions, and the
finished SVG. SVGs containing script, event handlers, embedded images, external
references, animation, `foreignObject`, or CSS URLs are rejected before being
written to `data/assets/generated/`.

Anything kept is tagged `generated:codex` and **`needs-review`**. Treat the
questions, answers, and diagrams as drafts. They are written to the bank only
when "Save generated questions" is selected.

## API

| Route | Purpose |
|---|---|
| `GET /api/syllabus` | Syllabus JSON + per-topic bank counts. |
| `GET /api/questions` | Query the bank (`topicId`, `format`, `difficulty`, `kind`, `search`, `limit`, `offset`). |
| `DELETE /api/questions?id=…` | Remove one entry. |
| `GET /api/assets/[...path]` | Serve a question figure from `data/assets`. |
| `POST /api/import` | Import a bank file. `?dryRun=1` validates without writing, `?skipAssetCheck=1` skips the figure-exists check. |
| `POST /api/generate` | Generate a paper. Body: `{mode, topicIds, formats?, difficulties?, count, seed?, notes?, save?}`. |
| `GET /api/generation-progress?threadId=…` | Read live question-writing and layout progress for a Codex generation. |
| `GET/POST /api/codex` | List/resume Codex threads, stream turns, interrupt work, and resolve approvals. |
| `GET/POST/DELETE /api/auth` | Check, create, or clear the private site session. |

```bash
curl -X POST localhost:3000/api/generate -H 'content-type: application/json' \
  -d '{"mode":"template","topicIds":["T2","T15"],"count":6,"seed":20260728}'
```

## Layout

```
data/syllabus/6091-physics.json   machine-readable syllabus (single source of truth)
data/questions/seed.json          starter bank: 6 static questions + 6 templates
data/assets/                      question figures, served via /api/assets
src/lib/types.ts                  domain model
src/lib/syllabus.ts               syllabus loading + topic lookup
src/lib/db.ts                     SQLite storage (better-sqlite3)
src/lib/import.ts                 validation + JSON/JSONL/CSV parsing
src/lib/assets.ts                 asset path safety (client-safe)
src/lib/assets.server.ts          asset resolution against data/assets
src/lib/stage.ts                  normalise parser output into assets[] shape
tools/parse/                      PDF parser commands and measurements
src/lib/template/expr.ts          safe expression evaluator
src/lib/template/engine.ts        seeded variant expansion
src/lib/llm/generate.ts           local Codex-authored questions + SVG validation
src/lib/paper.ts                  paper assembly across the three modes
src/app/                          Next.js App Router pages + API routes
test/                             expression, engine, and import tests
```

Storage is SQLite at `data/bank.sqlite` (override with `QG_DB_PATH`). It is gitignored — the
bank is your data, not repo content.

## Known limits

- Paper 3 (practical) is modelled in the syllabus but not generated: AO3 needs real apparatus.
- Templates still cannot generate figures from variables, so their varying
  values must stay out of fixed images. Codex-authored questions can generate
  standalone SVG figures and must do so for at least 30% of each request.
- Sub-topic-level syllabus data is unverified (see above).
- Authentication is a single shared access key, not multi-user accounts or per-user roles.
