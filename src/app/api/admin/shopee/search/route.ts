import { NextRequest, NextResponse } from "next/server";
import { searchProducts } from "@/lib/shopee/hubClient";
import { mapShopeeItems } from "@/lib/collect/shopee";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const keyword = request.nextUrl.searchParams.get("q") ?? "";
  const rawPage = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  try {
    const { items, hasNextPage } = await searchProducts(keyword, page);
    await persistItems("SHOPEE", mapShopeeItems(items));
    const rows = await findHighlightsByProductIds("SHOPEE", items.map((item) => item.itemId));
    return NextResponse.json({ items: rows, hasNextPage });
  } catch (error) {
    console.error("Shopee hub search failed:", error);
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }
}
