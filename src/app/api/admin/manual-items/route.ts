import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { createManualItems, type ManualItemInput } from "@/lib/manualItems/createManualItems";

function parseItem(raw: unknown): ManualItemInput | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const body = raw as Record<string, unknown>;
  const imageLink = typeof body.imageLink === "string" ? body.imageLink.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const affiliateLink = typeof body.affiliateLink === "string" ? body.affiliateLink.trim() : "";
  const price = typeof body.price === "number" ? body.price : NaN;
  const discount =
    typeof body.discount === "number" && Number.isFinite(body.discount) ? body.discount : null;
  const addToPost = body.addToPost === true;

  if (
    !imageLink ||
    !name ||
    !affiliateLink ||
    Number.isNaN(price) ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }

  return { imageLink, name, price, discount, affiliateLink, addToPost };
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const rawItems: unknown[] | null = Array.isArray(body?.items) ? body.items : null;
  if (!rawItems || rawItems.length === 0) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const items = rawItems.map(parseItem);
  if (items.some((item) => item === null)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await createManualItems(items as ManualItemInput[]);
  if (!result.ok) {
    return NextResponse.json(
      { error: "unrecognized_link", unrecognizedIndices: result.unrecognizedIndices },
      { status: 400 }
    );
  }

  return NextResponse.json({ results: result.results });
}
