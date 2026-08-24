import type { Highlight, Marketplace } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pickRandomNote } from "@/lib/highlights/noteTemplates";
import type { CollectItem } from "@/lib/collect/types";

export async function persistItems(
  marketplace: Marketplace,
  items: CollectItem[]
): Promise<{ inserted: number; skipped: number }> {
  const valid = items.filter((item) => item.image.length > 0 && item.price > 0);
  if (valid.length === 0) {
    return { inserted: 0, skipped: items.length };
  }

  for (const item of valid) {
    await prisma.highlight.upsert({
      where: { marketplace_productId: { marketplace, productId: item.productId } },
      create: {
        marketplace,
        productId: item.productId,
        title: item.title,
        affiliateLink: item.affiliateLink,
        image: item.image,
        price: item.price,
        oldPrice: item.oldPrice,
        discount: item.discount,
        note: pickRandomNote(),
      },
      update: {
        price: item.price,
        oldPrice: item.oldPrice,
        discount: item.discount,
      },
    });
  }

  return { inserted: valid.length, skipped: items.length - valid.length };
}

export async function findHighlightsByProductIds(
  marketplace: Marketplace,
  productIds: string[]
): Promise<Highlight[]> {
  if (productIds.length === 0) {
    return [];
  }
  return prisma.highlight.findMany({
    where: { marketplace, productId: { in: productIds } },
  });
}
