import { NextResponse, type NextRequest } from "next/server";
import { countEntries, getStaticQuestions } from "@/lib/db";
import { savePaperPdf } from "@/lib/pdf.server";
import { isValidTopicId } from "@/lib/syllabus";
import type { GeneratedPaper } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BANK_PDF_QUESTIONS = 500;

interface BankPdfRequest {
  topicId?: unknown;
  kind?: unknown;
  search?: unknown;
  withAnswers?: unknown;
}

export async function POST(request: NextRequest) {
  let body: BankPdfRequest;
  try {
    body = (await request.json()) as BankPdfRequest;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const topicId = typeof body.topicId === "string" ? body.topicId.trim() : "";
  if (topicId && !isValidTopicId(topicId)) {
    return NextResponse.json({ error: `unknown topic id: ${topicId}` }, { status: 400 });
  }
  if (body.kind === "template") {
    return NextResponse.json(
      { error: "Templates cannot be printed until they are expanded into questions." },
      { status: 400 },
    );
  }
  const search = typeof body.search === "string" ? body.search.trim() : "";
  if (search.length > 200) {
    return NextResponse.json({ error: "search text is too long" }, { status: 400 });
  }

  const filters = {
    kind: "static" as const,
    topicIds: topicId ? [topicId] : undefined,
    search: search || undefined,
  };
  const total = countEntries(filters);
  if (total === 0) {
    return NextResponse.json(
      { error: "No concrete questions match the current filters." },
      { status: 404 },
    );
  }
  if (total > MAX_BANK_PDF_QUESTIONS) {
    return NextResponse.json(
      {
        error: `The current filters match ${total} questions. Narrow them to ${MAX_BANK_PDF_QUESTIONS} or fewer before exporting.`,
      },
      { status: 400 },
    );
  }

  const questions = getStaticQuestions({
    ...filters,
    limit: MAX_BANK_PDF_QUESTIONS,
  });
  const paper: GeneratedPaper = {
    mode: "retrieve",
    generatedAt: new Date().toISOString(),
    totalMarks: questions.reduce((sum, question) => sum + question.marks, 0),
    questions,
    warnings: [],
  };
  const withAnswers = body.withAnswers === true;
  const filename = withAnswers ? "6091-bank-with-answers.pdf" : "6091-bank.pdf";

  try {
    const exported = await savePaperPdf(paper, { withAnswers, filename });
    return new Response(new Uint8Array(exported.buffer), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-qg-question-count": String(questions.length),
        "x-qg-saved-path": `output/pdf/${filename}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
