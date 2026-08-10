import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/mercadolivre/session";
import {
  searchAffiliateProducts,
  MercadoLivreSessionExpiredError,
  type MLHubSort,
  type MLHubFilter,
} from "@/lib/mercadolivre/hubClient";
import { mapMercadoLivreItems } from "@/lib/collect/mercadolivre";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";

export const maxDuration = 60;

function parseSort(value: string | null): MLHubSort {
  return value === "lowest_price" || value === "highest_price" ? value : "relevance";
}

// Mercado Livre's hub treats extra_commission and best_seller as mutually
// exclusive (picking one clears the other in their own UI) — best_seller
// wins if a caller somehow sends both.
function parseFilters(searchParams: URLSearchParams): MLHubFilter[] {
  const filters: MLHubFilter[] = [];

  const categoryId = searchParams.get("categoryId");
  const categoryName = searchParams.get("categoryName");
  if (categoryId && categoryName) {
    filters.push({ id: "category", value: categoryId, name: categoryName });
  }

  if (searchParams.get("bestSeller") === "true") {
    filters.push({ id: "best_seller", value: true });
  } else if (searchParams.get("extraCommission") === "true") {
    filters.push({ id: "extra_commission", value: true });
  }

  return filters;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const rawOffset = Number(request.nextUrl.searchParams.get("offset"));
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const sort = parseSort(request.nextUrl.searchParams.get("sort"));
  const filters = parseFilters(request.nextUrl.searchParams);

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }

  try {
    const items = await searchAffiliateProducts(query, session, offset, { sort, filters });
    const mapped = await mapMercadoLivreItems(items, session);
    await persistItems("MERCADO_LIVRE", mapped);
    const rows = await findHighlightsByProductIds("MERCADO_LIVRE", items.map((item) => item.itemId));
    return NextResponse.json({ items: rows, fetchedCount: items.length });
  } catch (error) {
    if (error instanceof MercadoLivreSessionExpiredError) {
      return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }
    console.error("Mercado Livre hub search failed:", error);
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }
}
