import { NextRequest, NextResponse } from "next/server";
import { refreshAccessToken } from "@/lib/mercadolivre/auth";
import { MercadoLivreClient } from "@/lib/mercadolivre/client";
import { collectMercadoLivreDeals } from "@/lib/mercadolivre/collect";
import { upsertProducts } from "@/lib/products/upsert";

export const maxDuration = 60;

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

  try {
    const accessToken = await refreshAccessToken();
    const client = new MercadoLivreClient(accessToken);
    const products = await collectMercadoLivreDeals(getSearchQueries(), client);
    const count = await upsertProducts(products);

    return NextResponse.json({ collected: count });
  } catch (error) {
    console.error("Mercado Livre collect failed:", error);
    return NextResponse.json({ error: "Collection failed" }, { status: 500 });
  }
}
