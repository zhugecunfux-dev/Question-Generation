import { NextResponse, type NextRequest } from "next/server";
import { parseImportPayload } from "@/lib/import";
import { upsertEntries } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Accepts a raw body (JSON array / JSONL / CSV / `{questions:[...]}`) or a
 * multipart upload with a `file` field.
 *
 * `?dryRun=1` validates and reports without writing — use it first on a new
 * export format so a malformed file can't half-fill the bank.
 */
export async function POST(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const skipAssetCheck = request.nextUrl.searchParams.get("skipAssetCheck") === "1";

  let text: string;
  let filename = "";
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "multipart body needs a `file` field" }, { status: 400 });
      }
      filename = file.name;
      text = await file.text();
    } else {
      text = await request.text();
    }
  } catch (err) {
    return NextResponse.json(
      { error: `could not read request body: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  if (!text.trim()) {
    return NextResponse.json({ error: "empty body" }, { status: 400 });
  }

  let result;
  try {
    result = parseImportPayload(text, filename, { checkAssetFiles: !skipAssetCheck });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const written = dryRun ? 0 : upsertEntries(result.entries);

  return NextResponse.json({
    dryRun,
    parsed: result.entries.length,
    written,
    rejected: result.issues.length,
    issues: result.issues.slice(0, 100),
    truncatedIssues: Math.max(0, result.issues.length - 100),
  });
}
