import { NextResponse, type NextRequest } from "next/server";
import { getGenerationProgress } from "@/lib/generation-progress.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const threadId = request.nextUrl.searchParams.get("threadId")?.trim();
  if (!threadId) {
    return NextResponse.json({ error: "`threadId` is required" }, { status: 400 });
  }
  const progress = getGenerationProgress(threadId);
  if (!progress) {
    return NextResponse.json({ error: "generation progress not found" }, { status: 404 });
  }
  return NextResponse.json(
    { progress },
    { headers: { "cache-control": "no-store" } },
  );
}
