import { NextRequest, NextResponse } from "next/server";
import type { Marketplace } from "@prisma/client";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { listTodaysHighlights, listHighlightsPage } from "@/lib/highlights/store";

const VALID_MARKETPLACES: Marketplace[] = ["MERCADO_LIVRE", "AMAZON", "SHOPEE"];

// Mirrors the public vitrine's PAGE_SIZE so the admin pool paginates the
// same way the storefront does.
const PAGE_SIZE = 30;

function parseMarketplace(request: NextRequest): Marketplace | undefined {
  const raw = request.nextUrl.searchParams.get("marketplace");
  return VALID_MARKETPLACES.includes(raw as Marketplace) ? (raw as Marketplace) : undefined;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const marketplace = parseMarketplace(request);

  const rawPage = request.nextUrl.searchParams.get("page");
  if (rawPage === null) {
    // No page param: unchanged behaviour — dump every highlight collected today.
    const items = await listTodaysHighlights(marketplace);
    return NextResponse.json({ items });
  }

  const parsedPage = Number(rawPage);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const { items, totalPages } = await listHighlightsPage({
    page,
    pageSize: PAGE_SIZE,
    marketplaces: marketplace ? [marketplace] : VALID_MARKETPLACES,
    q: "",
  });
  return NextResponse.json({ items, totalPages });
}
