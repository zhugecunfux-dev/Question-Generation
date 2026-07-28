import { NextResponse, type NextRequest } from "next/server";
import { generatePaper } from "@/lib/paper";
import { LlmRefusalError, LlmUnavailableError } from "@/lib/llm/generate";
import { isValidTopicId } from "@/lib/syllabus";
import { upsertEntries } from "@/lib/db";
import type { Difficulty, GenerateRequest, QuestionFormat } from "@/lib/types";

export const dynamic = "force-dynamic";
// LLM generation on a full paper can take a while; don't let the platform
// time the route out at the default.
export const maxDuration = 300;

const MODES = new Set(["retrieve", "template", "llm"]);

export async function POST(request: NextRequest) {
  let body: Partial<GenerateRequest> & { save?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const mode = body.mode;
  if (!mode || !MODES.has(mode)) {
    return NextResponse.json({ error: "`mode` must be retrieve | template | llm" }, { status: 400 });
  }

  const topicIds = (body.topicIds ?? []).filter(Boolean);
  if (topicIds.length === 0) {
    return NextResponse.json({ error: "`topicIds` must not be empty" }, { status: 400 });
  }
  const unknown = topicIds.filter((id) => !isValidTopicId(id));
  if (unknown.length) {
    return NextResponse.json(
      { error: `unknown topic id(s): ${unknown.join(", ")}` },
      { status: 400 },
    );
  }

  const count = Number(body.count ?? 10);
  if (!Number.isFinite(count) || count < 1 || count > 60) {
    return NextResponse.json({ error: "`count` must be between 1 and 60" }, { status: 400 });
  }

  const req: GenerateRequest = {
    mode,
    topicIds,
    formats: body.formats as QuestionFormat[] | undefined,
    difficulties: body.difficulties as Difficulty[] | undefined,
    count: Math.round(count),
    seed: body.seed === undefined ? undefined : Number(body.seed),
    notes: body.notes,
  };

  try {
    const paper = await generatePaper(req);

    // LLM output is worth keeping (it is expensive to reproduce), but it lands
    // in the bank tagged `needs-review` rather than as trusted content.
    if (body.save && paper.questions.length) {
      upsertEntries(paper.questions);
    }

    return NextResponse.json(paper);
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof LlmRefusalError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
