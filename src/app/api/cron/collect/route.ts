import { NextResponse } from "next/server";
import { collectAmazon } from "@/lib/collect/amazon";
import { collectMercadoLivre } from "@/lib/collect/mercadolivre";
import { collectShopee } from "@/lib/collect/shopee";
import type { CollectResult } from "@/lib/collect/types";

function toResult(settled: PromiseSettledResult<CollectResult>): CollectResult {
  if (settled.status === "fulfilled") {
    return settled.value;
  }
  return { attempted: 0, inserted: 0, skipped: 0, error: String(settled.reason) };
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_COLLECT_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [amazon, mercadoLivre, shopee] = await Promise.allSettled([
    collectAmazon(),
    collectMercadoLivre(),
    collectShopee(),
  ]);

  const results = {
    amazon: toResult(amazon),
    mercadoLivre: toResult(mercadoLivre),
    shopee: toResult(shopee),
  };

  const hasError = Object.values(results).some((result) => result.error !== undefined);
  return NextResponse.json(results, { status: hasError ? 207 : 200 });
}
