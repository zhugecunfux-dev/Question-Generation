import { NextResponse, type NextRequest } from "next/server";
import { parsePdfExportRequest, savePaperPdf } from "@/lib/pdf.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const payload = parsePdfExportRequest(await request.json());
    const exported = await savePaperPdf(payload.paper, {
      withAnswers: payload.withAnswers,
    });

    return new Response(new Uint8Array(exported.buffer), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${exported.filename}"`,
        "cache-control": "no-store",
        "x-qg-saved-path": `output/pdf/${exported.filename}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
