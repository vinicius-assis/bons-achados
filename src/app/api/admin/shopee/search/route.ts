import { NextRequest, NextResponse } from "next/server";
import { searchProducts } from "@/lib/shopee/hubClient";
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
    return NextResponse.json({ items, hasNextPage });
  } catch (error) {
    console.error("Shopee hub search failed:", error);
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }
}
