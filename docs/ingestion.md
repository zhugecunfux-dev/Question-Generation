# Getting past papers into the bank

How to turn a stack of 6091 PDFs into bank entries, what it costs, and what to do
about figures.

## 1. Cost: the PDF path is expensive, but only once

When you hand Claude a PDF, it extracts the text **and** renders every page to an
image, so you pay for both. The documented range is roughly **1,500–3,000 tokens
per page**, and a single high-resolution page image on Opus can reach ~4,784
tokens on its own. Extracted text for the same page is usually 400–800 tokens —
so on a text-heavy page the image is most of what you're paying for, and it is
pure overhead once you have good text.

Measure it on your own papers rather than trusting a range — density varies a lot
between a diagram-heavy Paper 1 and a prose-heavy Paper 2:

```bash
npm run token-cost -- source/6091_2019_p1.pdf parsed/6091_2019_p1.md
```

**But reframe the question before optimising.** This is a *one-time ingestion*
cost. Once questions are parsed into `data/bank.sqlite`, generating papers never
touches the PDF again — retrieve and template modes don't call a model at all.
At Opus 5 input pricing, a 40-page paper as raw PDF is roughly $0.40 per pass;
fifty papers is about $20, once, ever.

So cost alone does not justify a complicated pipeline. What justifies it is
**accuracy and figure extraction** — and those are the reasons to convert.

## 2. Recommended pipeline: parse deterministically, structure with a model

Two stages, because they fail differently:

```
PDF ──[ Marker / MinerU ]──▶  Markdown + figure images + layout JSON
                                        │
                                        ▼
                          [ Claude, text-only, per question ]
                                        │
                                        ▼
                          bank JSON ──▶ npm run import
```

**Stage 1 — a dedicated parser, not a model.** It is deterministic, re-runnable,
free after setup, and — critically — it gives you **figures as separate image
files with their captions and page positions**. A vision model reading the whole
PDF gives you prose about a figure; a parser gives you the figure.

**Stage 2 — Claude on the extracted text only.** Splitting questions apart,
assigning `topicId`/`ao`/`marks`, and normalising the mark scheme is a judgement
task that a parser can't do, but it doesn't need pixels. Feeding it text instead
of page images is where the token saving actually lands. Chunk per question,
cache the system prompt and schema, and use a cheaper model — this stage is
classification, not reasoning.

Then feed the result through the existing importer, which already rejects rows
that don't validate against the syllabus (`npm run import -- --dry-run`).

## 3. Which parser

**For 6091 specifically, prioritise figure extraction over formula OCR.** O-Level
physics is *figure-heavy and formula-light* — circuits, ray diagrams, apparatus
sketches, velocity–time graphs, but very little that needs LaTeX beyond `v = u + at`.
That inverts the usual advice: the tools that win on maths benchmarks are solving
a problem you mostly don't have.

### Open source

| Tool | Fit for 6091 | Notes |
|---|---|---|
| [**MinerU**](https://github.com/opendatalab/MinerU) | **Strong first choice** | Markdown + JSON, extracts figures and tables as cropped images with captions. MinerU 2.5 scores 95.69 on OmniDocBench v1.6 at 1.2B params. Reported weakness: figure crops are occasionally clipped — check your first paper by eye. |
| [**Marker**](https://github.com/VikParuchuri/marker) | **Strong first choice** | Best-in-class structure fidelity and image handling; optional LLM pass to improve output. GPU-hungry, and check the licence terms for commercial use. |
| [**Docling**](https://github.com/docling-project/docling) | Good, most "engineerable" | IBM; rich `DoclingDocument` structure, first-class LangChain/LlamaIndex integration, and a built-in *picture description* enrichment step you can point at your own VLM. Slower. |
| [**dots.ocr**](https://github.com/rednote-hilab/dots.ocr) | Worth testing | Single 1.7B VLM doing layout + parsing in one pass; strong recent benchmark results. Newer, smaller ecosystem. |
| [**PyMuPDF4LLM**](https://github.com/pymupdf/RAG) | Fastest, if your PDFs are digital | CPU-only, very fast. Fine if your papers have a real text layer; useless on scans. Try this first — if the output is clean, you're done. |
| [**MarkItDown**](https://github.com/microsoft/markitdown) | Not for this | Fast and shallow. Loses the structure you need. |

Benchmark to check current standings yourself:
[**OmniDocBench**](https://github.com/opendatalab/OmniDocBench).

### Paid

| Service | When it's worth it |
|---|---|
| [**Mathpix**](https://mathpix.com/pdf-conversion) | The reliability leader for equations → LaTeX, and it handles scans and handwriting well. For 6091 its main strength is largely wasted — consider it if you later add A-Level H2 or IP maths, where the formula density justifies it. |
| [**LlamaParse**](https://www.llamaindex.ai/) | Complex layouts and embedded visuals with no infra to run. Good middle ground if you don't want a GPU. |
| **Azure Document Intelligence** / **Google Document AI** / **AWS Textract** | Volume, SLAs, and compliance. Layout models output Markdown directly. Overkill for a few dozen papers. |
| **Reducto**, **Chunkr**, **Datalab** (hosted Marker) | Hosted versions of the above class; Datalab is the managed Marker if you like Marker's output but not the GPU bill. |

**Suggested order:** try PyMuPDF4LLM first (minutes, free). If figures or layout
come out wrong, move to MinerU or Marker. Only pay for something if a real paper
defeats both.

## 4. Figures: three tiers, and one hard constraint

**Do not convert figures to prose as the primary representation.** A description
is lossy in exactly the way that matters — "a circuit with two resistors" cannot
be read off to answer a question about which resistor carries more current. The
current LLM validator in `src/lib/llm/generate.ts` actively *rejects* stems that
reference an undescribed figure; that was right for a text-only bank and needs to
change now that real figures are arriving.

**Tier 1 — keep the image, reference it.** The figure stays a PNG/SVG asset; the
question record points at it. This is the default and it is what the parser gives
you for free. Works for every mode that reuses a question as-authored.

**Tier 2 — add a description as metadata, not as a replacement.** A VLM-written
description of each figure is genuinely useful as *searchable text* and as
context when few-shotting the model, and it's the accessibility alt text. Store
it alongside the image, never instead of it.

**Tier 3 — regenerate the figure from parameters.** This is the hard constraint,
and it's specific to what this app does:

> A stored figure and a template variant are incompatible. If the template varies
> a number that appears in the figure, the figure becomes wrong the moment the
> numbers change.

Three honest ways out, in increasing effort:

1. **Vary only what isn't in the figure.** A circuit diagram labelled
   $R_1$, $R_2$, $V$ works with any values, as long as the values live in the
   stem rather than printed on the diagram. This covers a surprising amount of
   6091 and costs nothing.
2. **Mark figure-bearing templates as retrieve-only.** Keep them as static
   questions; don't parameterise them.
3. **Generate the figure alongside the numbers.** Emit SVG (or TikZ) from the
   same variables the template already samples — [CircuiTikZ](https://ctan.org/pkg/circuitikz)
   for circuits, the [TikZ optics library](https://ctan.org/pkg/tikz-optics) for
   ray diagrams, or plain SVG for graphs and free-body diagrams. This is the only
   option that makes a figure question truly parameterisable, and it is real work
   per figure family — worth it for the handful of shapes that recur across every
   paper (series/parallel circuits, v–t graphs, ray diagrams, inclined planes).

## 5. What's implemented

Tiers 1 and 2 are built.

**Storage.** Figures live in `data/assets/` (override with `QG_ASSETS_DIR`),
alongside the bank rather than in `public/`. They are served by
`/api/assets/[...path]`, which is the single place path containment is enforced —
`..`, absolute paths, drive letters, `file://` and `data:` URLs, NUL bytes and
symlinks pointing outside the root are all rejected. SVGs are served under a
`sandbox` CSP, since a bank file is untrusted input and an SVG can carry script.

**Schema.** `assets?: QuestionAsset[]` on both questions and templates:

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

Import accepts `assets` / `figures` / `images` / `image` / `figure`, a bare
string instead of an object, and `src` / `file` / `title` / `description` as
field aliases. A path that is unsafe, isn't an image, or isn't on disk is
**rejected and reported** like any other invalid row. Use
`--skip-asset-check` (CLI) or `?skipAssetCheck=1` (API) when the question JSON
arrives before the images have been copied across — the safety checks still
apply, only the existence check is skipped.

**Descriptions (tier 2).** `npm run describe-assets` fills in missing `alt` text
with Claude vision, prompted to record what is *drawn* — axis ranges, component
values, coordinates — and explicitly not to solve the question. Supports
`--dry-run` and `--force`. Note SVG is not a vision input type, so vector
figures need their `alt` written by hand (the shipped seed figure has one).

**Rendering.** `QuestionCard` renders figures with caption and alt text; the
Markdown export emits `![alt](assets/<path>)` so an exported paper still renders
when the assets directory sits beside it.

**Codex generation.** The local Codex-authored mode can attach a self-contained
SVG figure. At least 30% of every generated set must include one. Each SVG is
returned with a detailed production prompt, precise alt text, and dimensions;
unsafe or externally referenced SVG content is rejected before storage.

## 6. What's still open

- **Template tier 3** — Codex-authored questions can generate standalone SVGs,
  but there is still no figure-generator hook tied to template variables. A
  template with a fixed `assets` entry is safe only while varying quantities
  stay out of the image.
- **Raster figures for `describe-assets`** — SVGs are skipped; rasterising them
  would need a renderer this repo doesn't ship.
- **Deduplication** — the same figure reused across papers is stored per path,
  with no content hashing.
