import { NextRequest, NextResponse } from "next/server";
import { collectMercadoLivreDeals } from "@/lib/mercadolivre/collect";
import { upsertProducts } from "@/lib/products/upsert";

const DEFAULT_SEARCH_QUERIES = [
  "eletronicos em oferta",
  "casa em oferta",
  "informatica em oferta",
];

function getSearchQueries(): string[] {
  const raw = process.env.ML_SEARCH_QUERIES;
  if (!raw) {
    return DEFAULT_SEARCH_QUERIES;
  }
  return raw
    .split(",")
    .map((query) => query.trim())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-collect-secret");
  if (secret !== process.env.COLLECT_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const products = await collectMercadoLivreDeals(getSearchQueries());
  const count = await upsertProducts(products);

  return NextResponse.json({ collected: count });
}
