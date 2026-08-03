import { NextResponse } from "next/server";
import { deleteStalePostDrafts } from "@/lib/postdraft/store";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.POSTDRAFT_CLEANUP_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const deleted = await deleteStalePostDrafts();
  return NextResponse.json({ deleted });
}
