import { NextResponse } from "next/server";
import { deleteStalePostDrafts } from "@/lib/postdraft/store";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.POSTDRAFT_CLEANUP_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const deleted = await deleteStalePostDrafts();
  return NextResponse.json({ deleted });
}
