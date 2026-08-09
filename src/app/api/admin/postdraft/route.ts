import { NextRequest, NextResponse } from "next/server";
import type { Marketplace, ProductSource } from "@prisma/client";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { createPostDraft, listActivePostDrafts } from "@/lib/postdraft/store";
import { buildCaption } from "@/lib/postdraft/caption";

const VALID_MARKETPLACES: Marketplace[] = ["MERCADO_LIVRE", "AMAZON", "SHOPEE"];
const VALID_SOURCES: ProductSource[] = ["AUTO", "MANUAL"];

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const items = await listActivePostDrafts();
  const caption = buildCaption(
    items.map((item) => ({
      title: item.title,
      marketplace: item.marketplace,
      category: item.category,
      discount: item.discount,
    }))
  );

  return NextResponse.json({ items, caption });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const marketplace = body?.marketplace;
  const source = body?.source;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const imageTitle = typeof body?.imageTitle === "string" ? body.imageTitle.trim() : "";
  const affiliateLink = typeof body?.affiliateLink === "string" ? body.affiliateLink.trim() : "";
  const image = typeof body?.image === "string" ? body.image.trim() : "";
  const price = typeof body?.price === "number" ? body.price : NaN;
  const discount = typeof body?.discount === "number" ? body.discount : null;
  const category = typeof body?.category === "string" && body.category.trim() ? body.category.trim() : null;

  if (
    !VALID_MARKETPLACES.includes(marketplace) ||
    !VALID_SOURCES.includes(source) ||
    !title ||
    !imageTitle ||
    !affiliateLink ||
    !image ||
    Number.isNaN(price) ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await createPostDraft({
    marketplace,
    source,
    title,
    imageTitle,
    affiliateLink,
    image,
    price,
    discount,
    category,
  });

  if (result.status === "duplicate") {
    return NextResponse.json({ error: "duplicate", createdAt: result.createdAt }, { status: 409 });
  }

  return NextResponse.json({ id: result.id, category: result.category }, { status: 201 });
}
