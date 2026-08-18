import { fetchAccessToken, searchItems, getItems, AmazonCreatorsApiError, type AmazonDealItem } from "@/lib/amazon/creatorsApiClient";
import { persistItems } from "@/lib/collect/persist";
import { pickRandomSearchTerm } from "@/lib/collect/searchTerms";
import { prisma } from "@/lib/prisma";
import type { CollectItem, CollectResult } from "@/lib/collect/types";

const TARGET_ITEM_COUNT = 50;
const ITEMS_PER_PAGE = 10;
const MAX_PAGES = 5;

const REFRESH_BATCH_SIZE = 10;
const STALE_THRESHOLD_MS = 50 * 60 * 1000; // 50 min — under the 1h Offers TTL, with buffer

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function mapAmazonItems(items: AmazonDealItem[]): CollectItem[] {
  return items.map((item) => ({
    productId: item.asin,
    title: item.title,
    affiliateLink: item.affiliateLink,
    image: item.image,
    price: item.price,
    oldPrice: item.oldPrice,
    discount: item.discount,
  }));
}

export async function refreshAmazonPrices(): Promise<{ refreshed: number; error?: string }> {
  let staleRows: { id: string; productId: string }[];
  try {
    staleRows = await prisma.highlight.findMany({
      where: {
        marketplace: "AMAZON",
        updatedAt: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) },
      },
      select: { id: true, productId: true },
    });
  } catch (error) {
    console.error("refreshAmazonPrices failed to query stale rows:", error);
    return { refreshed: 0, error: "collect_failed" };
  }

  if (staleRows.length === 0) {
    return { refreshed: 0 };
  }

  let token: string;
  try {
    token = await fetchAccessToken();
  } catch (error) {
    console.error("refreshAmazonPrices failed to get a token:", error);
    return { refreshed: 0, error: "collect_failed" };
  }

  const rowsByAsin = new Map(staleRows.map((row) => [row.productId, row]));
  let refreshed = 0;
  let batchError: string | undefined;

  for (const batch of chunk(staleRows, REFRESH_BATCH_SIZE)) {
    try {
      const freshItems = await getItems(batch.map((row) => row.productId), token);
      const seenAsins = new Set<string>();
      for (const item of freshItems) {
        const row = rowsByAsin.get(item.asin);
        if (!row) {
          continue;
        }
        seenAsins.add(item.asin);
        await prisma.highlight.update({
          where: { id: row.id },
          data: { price: item.price, oldPrice: item.oldPrice, discount: item.discount },
        });
        refreshed++;
      }

      // Rows in this batch that never came back (delisted ASINs) would stay
      // "stale" forever and get re-batched into every future refresh cycle.
      // Bump just their updatedAt so they age out for another cycle instead.
      for (const row of batch) {
        if (!seenAsins.has(row.productId)) {
          await prisma.highlight.update({
            where: { id: row.id },
            data: { updatedAt: new Date() },
          });
        }
      }
    } catch (error) {
      if (error instanceof AmazonCreatorsApiError && error.rateLimited) {
        console.error("refreshAmazonPrices rate limited, stopping remaining batches:", error);
        batchError = "rate_limited";
        break;
      }
      console.error("refreshAmazonPrices batch failed:", error);
      if (!batchError) {
        batchError = "refresh_failed";
      }
    }
  }

  return batchError ? { refreshed, error: batchError } : { refreshed };
}

export async function collectAmazon(): Promise<CollectResult> {
  const searchTerm = pickRandomSearchTerm();
  let discoveryResult: CollectResult;

  try {
    const token = await fetchAccessToken();

    const fetched: AmazonDealItem[] = [];
    for (let page = 1; page <= MAX_PAGES && fetched.length < TARGET_ITEM_COUNT; page++) {
      const pageItems = await searchItems(searchTerm, page, token);
      fetched.push(...pageItems);
      if (pageItems.length < ITEMS_PER_PAGE) {
        break;
      }
    }
    const items = fetched.slice(0, TARGET_ITEM_COUNT);

    if (items.length === 0) {
      discoveryResult = { attempted: 0, inserted: 0, skipped: 0 };
    } else {
      const mapped = mapAmazonItems(items);
      const { inserted, skipped } = await persistItems("AMAZON", mapped);
      discoveryResult = { attempted: items.length, inserted, skipped };
    }
  } catch (error) {
    if (error instanceof AmazonCreatorsApiError && error.rateLimited) {
      discoveryResult = { attempted: 0, inserted: 0, skipped: 0, error: "rate_limited" };
    } else {
      console.error("collectAmazon failed:", error);
      discoveryResult = { attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" };
    }
  }

  try {
    const refreshResult = await refreshAmazonPrices();
    if (refreshResult.error && !discoveryResult.error) {
      discoveryResult.error = refreshResult.error;
    }
  } catch (error) {
    // Belt-and-suspenders: refreshAmazonPrices() should never throw (it
    // catches its own failures), but collectAmazon() must still return the
    // discovery result even if it somehow does.
    console.error("collectAmazon: refreshAmazonPrices unexpectedly threw:", error);
  }

  return discoveryResult;
}
