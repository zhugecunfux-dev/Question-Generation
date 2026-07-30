import { NextResponse } from "next/server";
import { getSyllabus } from "@/lib/syllabus";
import { topicCounts } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ syllabus: getSyllabus(), counts: topicCounts() });
}
