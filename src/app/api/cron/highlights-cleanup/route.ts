import { NextResponse } from "next/server";
import { deleteStaleHighlights } from "@/lib/highlights/store";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.HIGHLIGHTS_CLEANUP_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const deleted = await deleteStaleHighlights();
  return NextResponse.json({ deleted });
}
