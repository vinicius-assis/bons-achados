import { NextRequest, NextResponse } from "next/server";
import type { Marketplace } from "@prisma/client";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { createHighlight, listTodaysHighlights } from "@/lib/highlights/store";

const VALID_MARKETPLACES: Marketplace[] = ["MERCADO_LIVRE", "AMAZON", "SHOPEE"];

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const items = await listTodaysHighlights();
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const marketplace = body?.marketplace;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const affiliateLink = typeof body?.affiliateLink === "string" ? body.affiliateLink.trim() : "";
  const image = typeof body?.image === "string" ? body.image.trim() : "";
  const price = typeof body?.price === "number" ? body.price : NaN;
  const oldPrice = typeof body?.oldPrice === "number" ? body.oldPrice : null;
  const discount = typeof body?.discount === "number" ? body.discount : null;

  if (
    !VALID_MARKETPLACES.includes(marketplace) ||
    !title ||
    !affiliateLink ||
    !image ||
    Number.isNaN(price) ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const created = await createHighlight({
    marketplace,
    title,
    affiliateLink,
    image,
    price,
    oldPrice,
    discount,
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
