import { NextResponse, type NextRequest } from "next/server";
import { getPublicKnowledgeSource } from "@/lib/knowledge.server";

export const dynamic = "force-dynamic";

const PRIVATE_JSON_HEADERS = { "cache-control": "private, no-store" };

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ sourceId: string }> },
) {
  const { sourceId } = await context.params;
  const source = getPublicKnowledgeSource(sourceId);
  if (!source) {
    return NextResponse.json(
      { error: "knowledge source not found" },
      { status: 404, headers: PRIVATE_JSON_HEADERS },
    );
  }
  return NextResponse.json({ source }, { headers: PRIVATE_JSON_HEADERS });
}
