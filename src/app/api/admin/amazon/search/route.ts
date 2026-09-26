import { NextRequest, NextResponse } from "next/server";
import { fetchAccessToken, searchItems, AmazonCreatorsApiError, type AmazonSearchFilters } from "@/lib/amazon/creatorsApiClient";
import { getAmazonSource } from "@/lib/amazon/source";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";

export const maxDuration = 60;

function parseFilters(searchParams: URLSearchParams): AmazonSearchFilters {
  const filters: AmazonSearchFilters = {};
  const searchIndex = searchParams.get("searchIndex");
  const sortBy = searchParams.get("sortBy");
  const brand = searchParams.get("brand");
  const minPrice = searchParams.get("minPrice");
  const maxPrice = searchParams.get("maxPrice");
  const prime = searchParams.get("prime");

  if (searchIndex) filters.searchIndex = searchIndex;
  if (sortBy) filters.sortBy = sortBy;
  if (brand) filters.brand = brand;
  if (minPrice) {
    const parsed = Number(minPrice);
    if (Number.isFinite(parsed)) filters.minPrice = parsed;
  }
  if (maxPrice) {
    const parsed = Number(maxPrice);
    if (Number.isFinite(parsed)) filters.maxPrice = parsed;
  }
  if (prime === "true") filters.prime = true;

  return filters;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Keyword search only exists in the Creators API; the deals feed can't do it.
  if (getAmazonSource() === "web") {
    return NextResponse.json({ error: "search_unavailable" }, { status: 501 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const rawPage = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const filters = parseFilters(request.nextUrl.searchParams);

  try {
    const token = await fetchAccessToken();
    const items = await searchItems(query, page, token, filters);
    const mapped = items.map((item) => ({
      productId: item.asin,
      title: item.title,
      affiliateLink: item.affiliateLink,
      image: item.image,
      price: item.price,
      oldPrice: item.oldPrice,
      discount: item.discount,
    }));
    await persistItems("AMAZON", mapped);
    const rows = await findHighlightsByProductIds("AMAZON", items.map((item) => item.asin));
    return NextResponse.json({ items: rows, fetchedCount: items.length });
  } catch (error) {
    if (error instanceof AmazonCreatorsApiError && error.rateLimited) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    console.error("Amazon Creators API search failed:", error);
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }
}
