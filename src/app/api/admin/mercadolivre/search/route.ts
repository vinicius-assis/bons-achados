import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/mercadolivre/session";
import { searchAffiliateProducts, MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { findGeneratedTodayMap } from "@/lib/mercadolivre/createLink";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }

  try {
    const items = await searchAffiliateProducts(query, session);
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
