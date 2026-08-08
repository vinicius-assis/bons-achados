import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/mercadolivre/session";
import type { MLHubSession } from "@/lib/mercadolivre/session";
import {
  searchAffiliateProducts,
  MercadoLivreSessionExpiredError,
  type MLHubItem,
} from "@/lib/mercadolivre/hubClient";
import { createAffiliateLink } from "@/lib/mercadolivre/createLink";
import { parseDiscountPercentage } from "@/lib/mercadolivre/discountLabel";
import { persistItems } from "@/lib/collect/persist";
import { pickRandomSearchTerm } from "@/lib/collect/searchTerms";
import type { CollectItem, CollectResult } from "@/lib/collect/types";

const TARGET_ITEM_COUNT = 50;

// Mercado Livre's hub search doesn't return an affiliate link — generating
// one costs a network call (createLink), so items already pooled today are
// skipped before spending that call, not just before the final write.
export async function mapMercadoLivreItems(
  items: MLHubItem[],
  session: MLHubSession
): Promise<CollectItem[]> {
  if (items.length === 0) {
    return [];
  }

  const existing = await prisma.highlight.findMany({
    where: { marketplace: "MERCADO_LIVRE", productId: { in: items.map((item) => item.itemId) } },
    select: { productId: true },
  });
  const existingIds = new Set(existing.map((row) => row.productId));

  const results: CollectItem[] = [];
  for (const item of items) {
    if (existingIds.has(item.itemId)) {
      continue;
    }
    const { shortUrl } = await createAffiliateLink(item.permalink, session);
    results.push({
      productId: item.itemId,
      title: item.title,
      affiliateLink: shortUrl,
      image: item.image,
      price: item.price,
      oldPrice: item.oldPrice,
      discount: parseDiscountPercentage(item.discountLabel),
    });
  }
  return results;
}

export async function collectMercadoLivre(term?: string): Promise<CollectResult> {
  const session = await getSession();
  if (!session) {
    return { attempted: 0, inserted: 0, skipped: 0, error: "no_session" };
  }

  const searchTerm = term ?? pickRandomSearchTerm();

  try {
    const fetched: MLHubItem[] = [];
    let offset = 0;
    while (fetched.length < TARGET_ITEM_COUNT) {
      const page = await searchAffiliateProducts(searchTerm, session, offset);
      if (page.length === 0) {
        break;
      }
      fetched.push(...page);
      offset += page.length;
    }
    const items = fetched.slice(0, TARGET_ITEM_COUNT);

    if (items.length === 0) {
      return { attempted: 0, inserted: 0, skipped: 0 };
    }

    const mapped = await mapMercadoLivreItems(items, session);
    const { inserted, skipped } = await persistItems("MERCADO_LIVRE", mapped);
    return { attempted: items.length, inserted, skipped: skipped + (items.length - mapped.length) };
  } catch (error) {
    if (error instanceof MercadoLivreSessionExpiredError) {
      return { attempted: 0, inserted: 0, skipped: 0, error: "session_expired" };
    }
    console.error("collectMercadoLivre failed:", error);
    return { attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" };
  }
}
