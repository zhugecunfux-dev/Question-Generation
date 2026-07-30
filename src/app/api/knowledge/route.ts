import { NextResponse, type NextRequest } from "next/server";
import {
  listKnowledgeTopics,
  listPublicKnowledgeSources,
} from "@/lib/knowledge.server";
import { isValidTopicId } from "@/lib/syllabus";

export const dynamic = "force-dynamic";

const PRIVATE_JSON_HEADERS = { "cache-control": "private, no-store" };

export function GET(request: NextRequest) {
  const topicId = request.nextUrl.searchParams.get("topicId")?.trim().toUpperCase();
  if (topicId && !isValidTopicId(topicId)) {
    return NextResponse.json(
      { error: `unknown topic id "${topicId}"` },
      { status: 400, headers: PRIVATE_JSON_HEADERS },
    );
  }

  return NextResponse.json(
    {
      topics: listKnowledgeTopics(),
      sources: listPublicKnowledgeSources(topicId || undefined),
    },
    { headers: PRIVATE_JSON_HEADERS },
  );
}
