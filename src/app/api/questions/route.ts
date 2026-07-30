import { NextResponse, type NextRequest } from "next/server";
import { countEntries, deleteEntry, queryEntries } from "@/lib/db";
import type { Difficulty, QuestionFormat } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const list = (key: string) => params.getAll(key).flatMap((v) => v.split(",")).filter(Boolean);

  const filters = {
    kind: (params.get("kind") as "static" | "template" | null) ?? undefined,
    topicIds: list("topicId"),
    formats: list("format") as QuestionFormat[],
    difficulties: list("difficulty") as Difficulty[],
    search: params.get("search") ?? undefined,
    limit: Number(params.get("limit") ?? 50),
    offset: Number(params.get("offset") ?? 0),
  };

  return NextResponse.json({
    total: countEntries(filters),
    entries: queryEntries(filters),
  });
}

export function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing `id`" }, { status: 400 });
  const removed = deleteEntry(id);
  return NextResponse.json({ removed }, { status: removed ? 200 : 404 });
}
