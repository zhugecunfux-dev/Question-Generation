import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import SVGtoPDF from "svg-to-pdfkit";
import { resolveAssetPath } from "@/lib/assets.server";
import type { GeneratedPaper, Question, QuestionAsset } from "@/lib/types";

const INK = "#172033";
const MUTED = "#667085";
const LINE = "#D8DEE9";
const ACCENT = "#1457D9";
const ANSWER_BG = "#F2F6FF";

const PAGE = {
  left: 54,
  right: 54,
  top: 50,
  bottom: 58,
};

const FONT_CANDIDATES = {
  regular: [
    process.env.QG_PDF_FONT,
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ],
  bold: [
    process.env.QG_PDF_FONT_BOLD,
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ],
};

export const PDF_OUTPUT_DIR = path.join(process.cwd(), "output", "pdf");

export function pdfFilename(withAnswers: boolean): string {
  return withAnswers ? "6091-paper-with-answers.pdf" : "6091-paper.pdf";
}

export function parsePdfExportRequest(value: unknown): {
  paper: GeneratedPaper;
  withAnswers: boolean;
} {
  if (!value || typeof value !== "object") throw new Error("body must be a JSON object");
  const body = value as Record<string, unknown>;
  if (!body.paper || typeof body.paper !== "object") throw new Error("`paper` is required");
  const candidate = body.paper as Record<string, unknown>;
  if (!Array.isArray(candidate.questions) || candidate.questions.length === 0) {
    throw new Error("`paper.questions` must not be empty");
  }
  if (candidate.questions.length > 60) throw new Error("a PDF can contain at most 60 questions");

  const questions = candidate.questions.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`question ${index + 1} is invalid`);
    const question = raw as Record<string, unknown>;
    if (question.kind !== "static" || typeof question.id !== "string") {
      throw new Error(`question ${index + 1} is not a concrete bank question`);
    }
    if (typeof question.stem !== "string" || !question.stem.trim()) {
      throw new Error(`question ${index + 1} has no stem`);
    }
    if (!Number.isFinite(Number(question.marks)) || Number(question.marks) < 1) {
      throw new Error(`question ${index + 1} has invalid marks`);
    }
    if (typeof question.answer !== "string") {
      throw new Error(`question ${index + 1} has no answer`);
    }
    return question as unknown as Question;
  });

  const mode = candidate.mode;
  if (mode !== "retrieve" && mode !== "template" && mode !== "llm") {
    throw new Error("`paper.mode` is invalid");
  }

  const generatedAt =
    typeof candidate.generatedAt === "string" && !Number.isNaN(Date.parse(candidate.generatedAt))
      ? candidate.generatedAt
      : new Date().toISOString();

  return {
    withAnswers: body.withAnswers === true,
    paper: {
      mode,
      generatedAt,
      seed: typeof candidate.seed === "number" ? candidate.seed : undefined,
      codexThreadId:
        typeof candidate.codexThreadId === "string" ? candidate.codexThreadId : undefined,
      illustrationThreadId:
        typeof candidate.illustrationThreadId === "string"
          ? candidate.illustrationThreadId
          : undefined,
      totalMarks: questions.reduce((sum, question) => sum + Math.round(question.marks), 0),
      questions,
      warnings: [],
    },
  };
}

function firstExisting(candidates: Array<string | undefined>): string | undefined {
  return candidates.find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)));
}

function registerFonts(doc: PDFKit.PDFDocument): { regular: string; bold: string } {
  const regular = firstExisting(FONT_CANDIDATES.regular);
  const bold = firstExisting(FONT_CANDIDATES.bold);
  if (regular) doc.registerFont("QG-Regular", regular);
  if (bold) doc.registerFont("QG-Bold", bold);
  return {
    regular: regular ? "QG-Regular" : "Helvetica",
    bold: bold ? "QG-Bold" : "Helvetica-Bold",
  };
}

/**
 * Keep the common bits of lightweight LaTeX readable in a printout. Full
 * mathematical typesetting is intentionally left to the browser preview; this
 * conversion prevents raw `$`, `\mathrm`, and braces appearing in the PDF.
 */
export function printableText(input: string): string {
  const superscript: Record<string, string> = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
    "+": "⁺",
    "-": "⁻",
  };
  const toSuperscript = (value: string) =>
    value.split("").map((char) => superscript[char] ?? char).join("");

  return input
    .replace(/\r\n?/g, "\n")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^{}]+)\}/g, "√($1)")
    .replace(/\^\{([+\-\d]+)\}/g, (_match, power: string) => toSuperscript(power))
    .replace(/\^([+\-\d])/g, (_match, power: string) => toSuperscript(power))
    .replace(/_\{([^{}]+)\}/g, "₍$1₎")
    .replace(/\\(?:mathrm|text|operatorname)\{([^{}]+)\}/g, "$1")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\degree/g, "°")
    .replace(/\\Delta/g, "Δ")
    .replace(/\\mu/g, "μ")
    .replace(/\\theta/g, "θ")
    .replace(/\\Omega/g, "Ω")
    .replace(/\\,/g, " ")
    .replace(/\$/g, "")
    .replace(/[{}]/g, "")
    .trim();
}

function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - PAGE.left - PAGE.right;
}

function ensureSpace(doc: PDFKit.PDFDocument, height: number): void {
  const bottom = doc.page.height - PAGE.bottom;
  if (doc.y + height > bottom) doc.addPage();
}

function svgIntrinsicSize(svg: string, asset: QuestionAsset): { width: number; height: number } {
  if (asset.width && asset.height) return { width: asset.width, height: asset.height };

  const viewBox = svg.match(/\bviewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  if (viewBox) {
    const width = Number(viewBox[1]);
    const height = Number(viewBox[2]);
    if (width > 0 && height > 0) return { width, height };
  }

  const width = Number(svg.match(/\bwidth\s*=\s*["']([\d.]+)/i)?.[1]);
  const height = Number(svg.match(/\bheight\s*=\s*["']([\d.]+)/i)?.[1]);
  return width > 0 && height > 0 ? { width, height } : { width: 640, height: 360 };
}

function fittedSize(
  intrinsic: { width: number; height: number },
  maxWidth: number,
  maxHeight = 250,
): { width: number; height: number } {
  const scale = Math.min(maxWidth / intrinsic.width, maxHeight / intrinsic.height, 1);
  return {
    width: Math.max(1, intrinsic.width * scale),
    height: Math.max(1, intrinsic.height * scale),
  };
}

async function drawFigure(
  doc: PDFKit.PDFDocument,
  asset: QuestionAsset,
  fonts: { regular: string; bold: string },
): Promise<void> {
  const absolute = resolveAssetPath(asset.path);
  if (!absolute || !fs.existsSync(absolute)) {
    ensureSpace(doc, 34);
    doc.font(fonts.regular).fontSize(9).fillColor(MUTED)
      .text(`[Figure unavailable: ${asset.caption ?? asset.alt ?? asset.path}]`);
    doc.moveDown(0.5);
    return;
  }

  const maxWidth = Math.min(contentWidth(doc) - 46, 390);
  const ext = path.extname(absolute).toLowerCase();
  try {
    if (ext === ".svg") {
      const svg = fs.readFileSync(absolute, "utf8");
      const size = fittedSize(svgIntrinsicSize(svg, asset), maxWidth);
      const captionHeight = asset.caption ? 18 : 0;
      ensureSpace(doc, size.height + captionHeight + 22);
      const x = PAGE.left + (contentWidth(doc) - size.width) / 2;
      const y = doc.y + 8;

      doc.save().rect(x - 5, y - 5, size.width + 10, size.height + 10)
        .fillAndStroke("#FFFFFF", LINE).restore();
      SVGtoPDF(doc, svg, x, y, {
        width: size.width,
        height: size.height,
        preserveAspectRatio: "xMidYMid meet",
        assumePt: true,
        imageCallback: () => {
          throw new Error("external images inside SVG are not allowed");
        },
        documentCallback: () => {
          throw new Error("external SVG documents are not allowed");
        },
        warningCallback: () => undefined,
      });
      doc.y = y + size.height + 8;
    } else {
      const rendered = await sharp(absolute)
        .rotate()
        .flatten({ background: "#FFFFFF" })
        .png()
        .toBuffer({ resolveWithObject: true });
      const intrinsic = {
        width: asset.width ?? rendered.info.width,
        height: asset.height ?? rendered.info.height,
      };
      const size = fittedSize(intrinsic, maxWidth);
      ensureSpace(doc, size.height + (asset.caption ? 18 : 0) + 22);
      const x = PAGE.left + (contentWidth(doc) - size.width) / 2;
      const y = doc.y + 8;

      doc.save().rect(x - 5, y - 5, size.width + 10, size.height + 10)
        .fillAndStroke("#FFFFFF", LINE).restore();
      doc.image(rendered.data, x, y, { width: size.width, height: size.height });
      doc.y = y + size.height + 8;
    }

    if (asset.caption) {
      doc.font(fonts.regular).fontSize(8.5).fillColor(MUTED)
        .text(printableText(asset.caption), PAGE.left, doc.y, {
          width: contentWidth(doc),
          align: "center",
        });
    }
    doc.moveDown(0.7);
  } catch {
    ensureSpace(doc, 34);
    doc.font(fonts.regular).fontSize(9).fillColor(MUTED)
      .text(`[Figure could not be rendered: ${asset.caption ?? asset.alt ?? asset.path}]`);
    doc.moveDown(0.5);
  }
}

function drawAnswerLines(
  doc: PDFKit.PDFDocument,
  question: Question,
): void {
  if (question.format === "mcq") return;
  const lines = Math.min(7, Math.max(2, question.marks + 1));
  ensureSpace(doc, lines * 19 + 8);
  doc.moveDown(0.25);
  for (let i = 0; i < lines; i++) {
    const y = doc.y + 13;
    doc.moveTo(PAGE.left + 26, y).lineTo(doc.page.width - PAGE.right, y)
      .lineWidth(0.45).strokeColor(LINE).stroke();
    doc.y += 19;
  }
}

function drawAnswerBox(
  doc: PDFKit.PDFDocument,
  question: Question,
  fonts: { regular: string; bold: string },
): void {
  const answer = printableText(question.answer);
  const solution = question.solution ? printableText(question.solution) : "";
  const width = contentWidth(doc) - 26;
  doc.font(fonts.regular).fontSize(9.5);
  const answerHeight = doc.heightOfString(answer, { width: width - 74 });
  const solutionHeight = solution
    ? doc.heightOfString(solution, { width: width - 18 }) + 15
    : 0;
  const boxHeight = Math.max(38, answerHeight + solutionHeight + 22);
  ensureSpace(doc, Math.min(boxHeight, 150) + 12);

  const x = PAGE.left + 26;
  const y = doc.y + 4;
  doc.save().roundedRect(x, y, width, boxHeight, 4).fill(ANSWER_BG).restore();
  doc.font(fonts.bold).fontSize(9.5).fillColor(ACCENT).text("Answer", x + 10, y + 9, {
    width: 56,
  });
  doc.font(fonts.regular).fillColor(INK).text(answer, x + 66, y + 9, {
    width: width - 76,
  });
  if (solution) {
    const solutionY = y + 14 + Math.max(12, answerHeight);
    doc.font(fonts.bold).fontSize(8.5).fillColor(MUTED)
      .text("Mark scheme", x + 10, solutionY, { width: width - 20 });
    doc.font(fonts.regular).fontSize(8.8).fillColor(INK)
      .text(solution, x + 10, solutionY + 13, { width: width - 20 });
  }
  doc.y = y + boxHeight + 7;
}

async function estimateFigureHeight(
  asset: QuestionAsset,
  maxWidth: number,
): Promise<number> {
  const absolute = resolveAssetPath(asset.path);
  if (!absolute || !fs.existsSync(absolute)) return 34;
  try {
    const ext = path.extname(absolute).toLowerCase();
    let intrinsic: { width: number; height: number };
    if (ext === ".svg") {
      const svg = fs.readFileSync(absolute, "utf8");
      intrinsic = svgIntrinsicSize(svg, asset);
    } else {
      const metadata = await sharp(absolute).metadata();
      intrinsic = {
        width: asset.width ?? metadata.width ?? 640,
        height: asset.height ?? metadata.height ?? 360,
      };
    }
    return fittedSize(intrinsic, maxWidth).height + (asset.caption ? 18 : 0) + 22;
  } catch {
    return 34;
  }
}

async function estimateQuestionHeight(
  doc: PDFKit.PDFDocument,
  question: Question,
  withAnswers: boolean,
  fonts: { regular: string; bold: string },
): Promise<number> {
  const width = contentWidth(doc);
  doc.font(fonts.regular).fontSize(10.5);
  let height = 34 + doc.heightOfString(printableText(question.stem), {
    width: width - 112,
    lineGap: 2.3,
  });

  const maxFigureWidth = Math.min(width - 46, 390);
  for (const asset of question.assets ?? []) {
    height += await estimateFigureHeight(asset, maxFigureWidth);
  }

  doc.font(fonts.regular).fontSize(10);
  for (const option of question.options ?? []) {
    height += Math.max(
      22,
      doc.heightOfString(printableText(option.text), {
        width: width - 62,
        lineGap: 1.5,
      }) + 5,
    );
  }

  if (withAnswers) {
    doc.font(fonts.regular).fontSize(9.5);
    height += 34 + doc.heightOfString(printableText(question.answer), {
      width: width - 100,
    });
    if (question.solution) {
      height += 18 + doc.heightOfString(printableText(question.solution), {
        width: width - 44,
      });
    }
  } else if (question.format !== "mcq") {
    height += Math.min(7, Math.max(2, question.marks + 1)) * 19 + 8;
  }
  return height + 22;
}

async function drawQuestion(
  doc: PDFKit.PDFDocument,
  question: Question,
  index: number,
  withAnswers: boolean,
  fonts: { regular: string; bold: string },
): Promise<void> {
  const estimatedHeight = await estimateQuestionHeight(doc, question, withAnswers, fonts);
  const fullPageHeight = doc.page.height - PAGE.top - PAGE.bottom;
  ensureSpace(doc, estimatedHeight <= fullPageHeight ? estimatedHeight : 92);
  const x = PAGE.left;
  const width = contentWidth(doc);
  const startY = doc.y;

  doc.font(fonts.bold).fontSize(11.5).fillColor(INK).text(`${index}.`, x, startY, {
    width: 28,
    continued: false,
  });
  doc.font(fonts.bold).fontSize(9.5).fillColor(MUTED).text(
    `[${question.marks} mark${question.marks === 1 ? "" : "s"}]`,
    x + width - 78,
    startY + 1,
    { width: 78, align: "right" },
  );

  const stemX = x + 28;
  doc.font(fonts.regular).fontSize(10.5).fillColor(INK)
    .text(printableText(question.stem), stemX, startY, {
      width: width - 112,
      lineGap: 2.3,
    });
  doc.x = x;
  doc.y += 4;

  for (const asset of question.assets ?? []) {
    await drawFigure(doc, asset, fonts);
  }

  if (question.options?.length) {
    for (const option of question.options) {
      ensureSpace(doc, 28);
      const optionY = doc.y + 1;
      doc.font(fonts.bold).fontSize(10).fillColor(INK)
        .text(`${option.label}.`, stemX + 4, optionY, { width: 24 });
      doc.font(fonts.regular).fontSize(10).fillColor(INK)
        .text(printableText(option.text), stemX + 30, optionY, {
          width: width - 62,
          lineGap: 1.5,
        });
      doc.y += 3;
    }
  }

  if (withAnswers) drawAnswerBox(doc, question, fonts);
  else drawAnswerLines(doc, question);

  doc.moveDown(0.55);
  doc.moveTo(x, doc.y).lineTo(x + width, doc.y).lineWidth(0.45).strokeColor(LINE).stroke();
  doc.y += 13;
}

function drawFirstPageHeader(
  doc: PDFKit.PDFDocument,
  paper: GeneratedPaper,
  withAnswers: boolean,
  fonts: { regular: string; bold: string },
): void {
  const width = contentWidth(doc);
  doc.rect(PAGE.left, PAGE.top, width, 4).fill(ACCENT);
  doc.y = PAGE.top + 21;
  doc.font(fonts.bold).fontSize(20).fillColor(INK)
    .text("O-Level Physics 6091", PAGE.left, doc.y, { width });
  doc.font(fonts.regular).fontSize(10.5).fillColor(MUTED)
    .text(withAnswers ? "Generated practice paper - answers and mark scheme" : "Generated practice paper", {
      width,
    });

  doc.moveDown(1);
  const metaY = doc.y;
  doc.font(fonts.bold).fontSize(9.5).fillColor(INK)
    .text(`Questions  ${paper.questions.length}`, PAGE.left, metaY, { width: 140 });
  doc.text(`Total marks  ${paper.totalMarks}`, PAGE.left + 150, metaY, { width: 140 });
  doc.font(fonts.regular).fillColor(MUTED)
    .text(`Generated  ${new Date(paper.generatedAt).toLocaleDateString("en-SG")}`, PAGE.left + 300, metaY, {
      width: width - 300,
      align: "right",
    });

  doc.y = metaY + 29;
  if (!withAnswers) {
    doc.font(fonts.regular).fontSize(9.5).fillColor(INK)
      .text("Name: ____________________________________    Date: ____________________", PAGE.left, doc.y, {
        width,
      });
    doc.moveDown(1.1);
    doc.font(fonts.regular).fontSize(9).fillColor(MUTED)
      .text("Answer all questions. Show clear working and include units where appropriate.", {
        width,
      });
  } else {
    doc.font(fonts.regular).fontSize(9).fillColor(MUTED)
      .text("Answers and marking guidance follow each question.", PAGE.left, doc.y, { width });
  }
  doc.moveDown(1.1);
  doc.moveTo(PAGE.left, doc.y).lineTo(PAGE.left + width, doc.y)
    .lineWidth(0.8).strokeColor(LINE).stroke();
  doc.y += 17;
}

function addPageFooters(
  doc: PDFKit.PDFDocument,
  fonts: { regular: string; bold: string },
): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Footer text sits inside the physical page margin. Temporarily remove the
    // layout margin so PDFKit does not interpret it as overflowing body text
    // and silently append a blank page for every footer.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 37;
    doc.moveTo(PAGE.left, y - 8).lineTo(doc.page.width - PAGE.right, y - 8)
      .lineWidth(0.4).strokeColor(LINE).stroke();
    doc.font(fonts.regular).fontSize(8).fillColor(MUTED)
      .text("6091 Physics practice", PAGE.left, y, { width: 180, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, doc.page.width - PAGE.right - 120, y, {
      width: 120,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = bottomMargin;
  }
}

export async function createPaperPdf(
  paper: GeneratedPaper,
  options: { withAnswers: boolean },
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: PAGE,
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: options.withAnswers
        ? "O-Level Physics 6091 - generated paper with answers"
        : "O-Level Physics 6091 - generated paper",
      Author: "Question Generation",
      Subject: "Singapore-Cambridge GCE O-Level Physics 6091 practice",
      CreationDate: new Date(),
    },
  });
  const fonts = registerFonts(doc);
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  drawFirstPageHeader(doc, paper, options.withAnswers, fonts);
  for (let i = 0; i < paper.questions.length; i++) {
    await drawQuestion(doc, paper.questions[i], i + 1, options.withAnswers, fonts);
  }
  addPageFooters(doc, fonts);
  doc.end();
  return completed;
}

export async function savePaperPdf(
  paper: GeneratedPaper,
  options: { withAnswers: boolean; filename?: string },
): Promise<{ buffer: Buffer; absolutePath: string; filename: string }> {
  const filename = options.filename ?? pdfFilename(options.withAnswers);
  if (
    path.basename(filename) !== filename ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/.test(filename)
  ) {
    throw new Error("PDF filename must be a safe local .pdf basename");
  }
  const buffer = await createPaperPdf(paper, options);
  const absolutePath = path.join(PDF_OUTPUT_DIR, filename);
  await fs.promises.mkdir(PDF_OUTPUT_DIR, { recursive: true });
  await fs.promises.writeFile(absolutePath, buffer);
  return { buffer, absolutePath, filename };
}
