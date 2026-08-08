import { NextRequest, NextResponse } from "next/server";
import type { Marketplace } from "@prisma/client";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { listTodaysHighlights } from "@/lib/highlights/store";

const VALID_MARKETPLACES: Marketplace[] = ["MERCADO_LIVRE", "AMAZON", "SHOPEE"];

function parseMarketplace(request: NextRequest): Marketplace | undefined {
  const raw = request.nextUrl.searchParams.get("marketplace");
  return VALID_MARKETPLACES.includes(raw as Marketplace) ? (raw as Marketplace) : undefined;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const items = await listTodaysHighlights(parseMarketplace(request));
  return NextResponse.json({ items });
}
