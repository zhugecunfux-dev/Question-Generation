import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { resolveKnowledgeFile } from "@/lib/knowledge.server";

export const dynamic = "force-dynamic";

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const PRIVATE_FILE_HEADERS = {
  "cache-control": "private, no-store",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ sourceId: string; path: string[] }> },
) {
  const { sourceId, path: segments } = await context.params;
  const requested = (segments ?? []).join("/");
  const resolved = resolveKnowledgeFile(sourceId, requested);
  if (!resolved) {
    return NextResponse.json(
      { error: "knowledge file not found" },
      { status: 404, headers: PRIVATE_FILE_HEADERS },
    );
  }

  let data: Buffer;
  try {
    data = fs.readFileSync(resolved.absolutePath);
  } catch {
    return NextResponse.json(
      { error: "knowledge file not found" },
      { status: 404, headers: PRIVATE_FILE_HEADERS },
    );
  }

  const extension = path.extname(resolved.file.name).toLowerCase();
  const contentType =
    resolved.file.kind === "markdown"
      ? "text/plain; charset=utf-8"
      : resolved.file.kind === "json"
        ? "application/json; charset=utf-8"
        : (IMAGE_CONTENT_TYPES[extension] ?? "application/octet-stream");

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": contentType,
      "content-length": String(data.byteLength),
      ...PRIVATE_FILE_HEADERS,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
