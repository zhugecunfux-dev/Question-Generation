import { NextResponse, type NextRequest } from "next/server";
import {
  buildImagegenHandoffPrompt,
  dispatchImagegenJobs,
  readImagegenJob,
} from "@/lib/imagegen-jobs.server";

export const dynamic = "force-dynamic";

function jobPathFromUrl(request: NextRequest): string | undefined {
  return request.nextUrl.searchParams.get("path")?.trim() || undefined;
}

export async function GET(request: NextRequest) {
  const jobPath = jobPathFromUrl(request);
  if (!jobPath) {
    return NextResponse.json({ error: "`path` is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      {
        job: readImagegenJob(jobPath),
        handoffPrompt: buildImagegenHandoffPrompt([jobPath]),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : String(cause) },
      { status: 404 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: { path?: unknown; retry?: unknown };
  try {
    body = (await request.json()) as { path?: unknown; retry?: unknown };
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const jobPath = typeof body.path === "string" ? body.path.trim() : "";
  if (!jobPath) {
    return NextResponse.json({ error: "`path` is required" }, { status: 400 });
  }

  try {
    const current = readImagegenJob(jobPath);
    if (current.status === "ready") {
      return NextResponse.json(
        { error: "This ImageGen job is already complete.", job: current },
        { status: 409 },
      );
    }
    if (current.status === "dispatched" && body.retry !== true) {
      return NextResponse.json(
        {
          error: "This ImageGen job is already running. Open its Codex task or retry explicitly.",
          job: current,
        },
        { status: 409 },
      );
    }
    const result = await dispatchImagegenJobs([jobPath]);
    return NextResponse.json({
      ok: true,
      threadId: result.threadId,
      turnId: result.turnId,
      job: result.jobs[0],
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : String(cause) },
      { status: 503 },
    );
  }
}
