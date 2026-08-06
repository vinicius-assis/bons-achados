import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/amazon/session";
import { listDeals, AmazonSessionExpiredError } from "@/lib/amazon/hubClient";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawOffset = Number(request.nextUrl.searchParams.get("offset"));
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }

  try {
    const { items, nextIndex } = await listDeals(offset, session);
    return NextResponse.json({ items, nextIndex });
  } catch (error) {
    if (error instanceof AmazonSessionExpiredError) {
      return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }
    console.error("Amazon deals search failed:", error);
    return NextResponse.json({ error: "deals_failed" }, { status: 502 });
  }
}
