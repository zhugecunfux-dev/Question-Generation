import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { CONTENT_TYPES } from "@/lib/assets";
import { resolveAssetPath } from "@/lib/assets.server";

export const dynamic = "force-dynamic";

/**
 * Serves question figures from `data/assets`.
 *
 * That directory sits outside `public/` on purpose: it is bank data, not app
 * code, and serving it through a route means path containment is enforced in
 * one place rather than trusted to the filenames in an imported bank.
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await ctx.params;
  const requested = (segments ?? []).map(decodeURIComponent).join("/");

  const resolved = resolveAssetPath(requested);
  if (!resolved) {
    return NextResponse.json({ error: "invalid asset path" }, { status: 400 });
  }

  let data: Buffer;
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error("not a file");
    data = fs.readFileSync(resolved);
  } catch {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }

  const type = CONTENT_TYPES[path.extname(resolved).toLowerCase()] ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": type,
      "content-length": String(data.byteLength),
      // SVGs are bank data and could carry script; never let one execute.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "public, max-age=3600",
    },
  });
}
