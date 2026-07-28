# 6091 Question Generator

A web app that generates Singapore-Cambridge GCE O-Level **Physics 6091** questions from an
existing question bank. Three generation modes, one syllabus model, one bank.

| Mode | What it does | When to use it |
|---|---|---|
| **Retrieve** | Picks existing questions from the bank, filtered by topic / format / difficulty. | Graded papers — nothing is invented. |
| **Template variants** | Expands parameterised templates into fresh number variants. Answers are *computed* from the template's own expressions. | Drill and homework sets; every student gets different numbers, same physics. |
| **Claude-authored** | Writes new questions few-shot on your bank, constrained to the syllabus and validated before display. | Concept and explanation questions that a template can't parameterise. |

Papers are reproducible: retrieve and template modes take a **seed**, so the same seed always
produces the same paper.

## Quick start

```bash
npm install
npm run import -- data/questions/seed.json   # load the starter bank (11 entries)
npm run dev                                   # http://localhost:3000
```

For Claude-authored mode, add an API key:

```bash
cp .env.example .env.local   # then set ANTHROPIC_API_KEY
```

Retrieve and template modes work without a key.

```bash
npm test        # 19 tests: expression evaluator, variant engine, importer
npm run build   # production build
```

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

## Claude-authored questions

`generateWithLlm` sends the model the exact topic and sub-topic list it may draw on, real
exemplars from your bank in the same format, and a JSON schema for the output. Returned
questions are then validated and **discarded** if they use an unrequested topic, produce an MCQ
without exactly four options and one key, allocate implausible marks, or reference a figure the
stem never describes.

Anything kept is tagged `generated:llm` **and `needs-review`** — surfaced with an amber badge in
the UI. Treat it as a first draft, not as bank-quality content. It is only written to the bank
if you tick "Save generated questions".

Model defaults to `claude-opus-5`; override with `ANTHROPIC_MODEL`.

## API

| Route | Purpose |
|---|---|
| `GET /api/syllabus` | Syllabus JSON + per-topic bank counts. |
| `GET /api/questions` | Query the bank (`topicId`, `format`, `difficulty`, `kind`, `search`, `limit`, `offset`). |
| `DELETE /api/questions?id=…` | Remove one entry. |
| `POST /api/import` | Import a bank file. `?dryRun=1` validates without writing. |
| `POST /api/generate` | Generate a paper. Body: `{mode, topicIds, formats?, difficulties?, count, seed?, notes?, save?}`. |

```bash
curl -X POST localhost:3000/api/generate -H 'content-type: application/json' \
  -d '{"mode":"template","topicIds":["T2","T15"],"count":6,"seed":20260728}'
```

## Layout

```
data/syllabus/6091-physics.json   machine-readable syllabus (single source of truth)
data/questions/seed.json          starter bank: 5 static questions + 6 templates
src/lib/types.ts                  domain model
src/lib/syllabus.ts               syllabus loading + topic lookup
src/lib/db.ts                     SQLite storage (better-sqlite3)
src/lib/import.ts                 validation + JSON/JSONL/CSV parsing
src/lib/template/expr.ts          safe expression evaluator
src/lib/template/engine.ts        seeded variant expansion
src/lib/llm/generate.ts           Claude-authored questions
src/lib/paper.ts                  paper assembly across the three modes
src/app/                          Next.js App Router pages + API routes
test/                             expression, engine, and import tests
```

Storage is SQLite at `data/bank.sqlite` (override with `QG_DB_PATH`). It is gitignored — the
bank is your data, not repo content.

## Known limits

- Paper 3 (practical) is modelled in the syllabus but not generated: AO3 needs real apparatus.
- No figure or diagram support. Questions needing one must describe it in words; the LLM
  validator actively rejects stems that reference an undescribed figure.
- Sub-topic-level syllabus data is unverified (see above).
- No multi-user auth — this is a single-tenant local/self-hosted tool as it stands.
