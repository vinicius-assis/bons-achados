import type { Highlight, Marketplace } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { startOfTodayInBrazil } from "@/lib/date";

export type CreateHighlightInput = {
  marketplace: Marketplace;
  productId: string;
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

export async function listTodaysHighlights(marketplace?: Marketplace): Promise<Highlight[]> {
  return prisma.highlight.findMany({
    where: {
      createdAt: { gte: startOfTodayInBrazil() },
      ...(marketplace ? { marketplace } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export type ListHighlightsPageInput = {
  page: number;
  pageSize: number;
  marketplaces: Marketplace[];
  q: string;
};

export type ListHighlightsPageResult = {
  items: Highlight[];
  hasNextPage: boolean;
};

export async function listHighlightsPage(
  input: ListHighlightsPageInput
): Promise<ListHighlightsPageResult> {
  const { page, pageSize, marketplaces, q } = input;
  const trimmedQuery = q.trim();

  const rows = await prisma.highlight.findMany({
    where: {
      createdAt: { gte: startOfTodayInBrazil() },
      marketplace: { in: marketplaces },
      ...(trimmedQuery ? { title: { contains: trimmedQuery, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize + 1,
  });

  return { items: rows.slice(0, pageSize), hasNextPage: rows.length > pageSize };
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
