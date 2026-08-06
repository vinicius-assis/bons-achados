import type { Highlight, Marketplace } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { startOfTodayInBrazil } from "@/lib/date";

export type CreateHighlightInput = {
  marketplace: Marketplace;
  title: string;
  note: string;
  affiliateLink: string;
  image: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
};

export async function createHighlight(input: CreateHighlightInput): Promise<Highlight> {
  return prisma.highlight.create({ data: input });
}

export async function listTodaysHighlights(): Promise<Highlight[]> {
  return prisma.highlight.findMany({
    where: { createdAt: { gte: startOfTodayInBrazil() } },
    orderBy: { createdAt: "desc" },
    // Explicit select so a future internal-only column added to Highlight
    // isn't silently exposed on the public vitrine page.
    select: {
      id: true,
      marketplace: true,
      title: true,
      note: true,
      affiliateLink: true,
      image: true,
      price: true,
      oldPrice: true,
      discount: true,
      createdAt: true,
    },
  });
}

export async function removeHighlight(id: string): Promise<void> {
  await prisma.highlight.deleteMany({ where: { id } });
}

export async function deleteStaleHighlights(): Promise<number> {
  const result = await prisma.highlight.deleteMany({
    where: { createdAt: { lt: startOfTodayInBrazil() } },
  });
  return result.count;
}
