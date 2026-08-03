import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/mercadolivre/session";
import { searchAffiliateProducts, MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { findGeneratedTodayMap } from "@/lib/mercadolivre/createLink";
import { isAuthorizedAdminRequest } from "@/lib/adminAuth";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const rawOffset = Number(request.nextUrl.searchParams.get("offset"));
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }

  try {
    const items = await searchAffiliateProducts(query, session, offset);
    const generatedTodayMap = await findGeneratedTodayMap(items.map((item) => item.itemId));
    const annotated = items.map((item) => ({
      ...item,
      generatedLink: generatedTodayMap.get(item.itemId) ?? null,
    }));
    return NextResponse.json({ items: annotated });
  } catch (error) {
    if (error instanceof MercadoLivreSessionExpiredError) {
      return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }
    console.error("Mercado Livre hub search failed:", error);
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }
}
