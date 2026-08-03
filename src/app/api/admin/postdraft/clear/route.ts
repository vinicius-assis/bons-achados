import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { clearActivePostDrafts } from "@/lib/postdraft/store";

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cleared = await clearActivePostDrafts();
  return NextResponse.json({ cleared });
}
