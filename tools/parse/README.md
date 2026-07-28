# Parsing papers

Stage 1 of the ingestion pipeline (see [`docs/ingestion.md`](../../docs/ingestion.md)):
PDF → Markdown + figure images. The parsers are Python; the app is Node, so
this stage runs separately and hands its output to `npm run stage`.

```
PDF ──▶ parser ──▶ out/<paper>/{*.md, images/*} ──▶ npm run stage ──▶ data/assets/ + staged.md
                                                                              │
                                                          structure into bank JSON
                                                                              │
                                                                    npm run import
```

## Choosing: run the cheap one first

| | PyMuPDF4LLM | MinerU / Marker |
|---|---|---|
| Install | one `pip install`, pure Python | pip + ~1 GB of model weights |
| Needs | CPU | GPU strongly preferred |
| Scanned pages | **cannot read them at all** | OCR built in |
| Speed | ~0.5 s/paper | tens of seconds to minutes |

**If your PDFs have a real text layer, PyMuPDF4LLM may be all you need.** Check
in one line before installing anything heavier:

```bash
python3 -c "import pymupdf,sys; d=pymupdf.open(sys.argv[1]); \
print('text characters:', sum(len(p.get_text().strip()) for p in d))" your-paper.pdf
```

A few thousand characters means a digital PDF — try the light path. **Zero means
it is a scan**, and only an OCR-capable parser will get anything out of it.

## Measured on a synthetic 6091 Paper 2

A two-page paper (four questions, one v–t graph figure, one data table), built
to look like the real thing, parsed in this repo's container:

| Input | Tool | Time | Markdown | Figures | Table |
|---|---|---|---|---|---|
| digital PDF (45 KB) | PyMuPDF4LLM | 0.45 s | 1,878 chars | 1, extracted clean and uncropped | recovered as a Markdown table |
| same pages rasterised, no text layer (13 MB) | PyMuPDF4LLM | 0.48 s | **0 chars** | — | — |

Two things worth noting beyond the headline. PyMuPDF4LLM also pulled the text
*inside* the figure into a `<!-- picture text -->` block — the axis labels and
tick values — which is useful raw material for the figure's `alt`. And
rasterising took the file from 45 KB to 13 MB: a scanned paper has no text layer,
so Claude's PDF path would be paying for page images alone.

**MinerU could not be benchmarked here.** It downloads its layout, OCR and
formula models from HuggingFace or ModelScope on first run, and this container's
network policy blocks both hosts. The commands below are from MinerU's
documentation, not from a run in this repo — expect to adjust them.

## PyMuPDF4LLM

```bash
pip install pymupdf4llm

python3 - <<'EOF'
import pathlib, pymupdf4llm
md = pymupdf4llm.to_markdown(
    "papers/6091_2019_p2.pdf",
    write_images=True,
    image_path="out/6091_2019_p2/images",
    image_format="png",
    dpi=150,
)
pathlib.Path("out/6091_2019_p2").mkdir(parents=True, exist_ok=True)
pathlib.Path("out/6091_2019_p2/paper.md").write_text(md, encoding="utf-8")
EOF
```

## MinerU

Needs network access to HuggingFace or ModelScope for the model download.

```bash
pip install -U "mineru[core]"

# First run downloads the models; set the source explicitly if HF is slow for you.
export MINERU_MODEL_SOURCE=modelscope    # or: huggingface

mineru -p papers/6091_2019_p2.pdf -o out/ --output-format markdown
```

MinerU writes `out/<name>/auto/` containing the Markdown, an `images/` folder,
and a `*_content_list.json` with per-block layout data. `npm run stage` walks
the tree, so pass the top directory.

Useful flags: `-l en` to pin the language, `-b pipeline` for the CPU-friendly
backend, `-d cuda` to force GPU. Check `mineru --help` — the CLI changed
between 1.x and 2.x.

## Marker

```bash
pip install marker-pdf
marker_single papers/6091_2019_p2.pdf --output_dir out/ --output_format markdown
```

Check the licence terms before commercial use.

## Then

```bash
npm run stage -- --in out/6091_2019_p2 --paper-id tys2019-p2
```

This renumbers the figures into reading order, copies them to
`data/assets/tys2019-p2/`, rewrites the Markdown image references to the
`tys2019-p2/fig-01.png` form that `assets[].path` expects, and writes
`staged.md` + `manifest.json` beside the parser output. Add `--dry-run` to see
what it would do.

Stage 2 — splitting `staged.md` into questions and assigning
`topicId`/`ao`/`marks` — is the model's job, on text rather than page images.
Feed the result to `npm run import -- --dry-run` first; it validates against the
syllabus and reports bad rows rather than writing them.
