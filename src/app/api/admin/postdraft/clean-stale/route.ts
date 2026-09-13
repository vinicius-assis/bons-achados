import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { deleteStalePostDrafts } from "@/lib/postdraft/store";

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const deleted = await deleteStalePostDrafts();
  return NextResponse.json({ deleted });
}
