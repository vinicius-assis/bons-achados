import type { Marketplace, PostDraft, ProductSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withDbRetry } from "@/lib/dbRetry";
import { categorize } from "@/lib/postdraft/categorize";
import { startOfTodayInBrazil } from "@/lib/date";

export type CreatePostDraftInput = {
  marketplace: Marketplace;
  source: ProductSource;
  title: string;
  imageTitle: string;
  affiliateLink: string;
  image: string;
  price: number;
  discount: number | null;
  category: string | null;
};

export type CreatePostDraftResult =
  | { status: "created"; id: string; category: string }
  | { status: "duplicate"; createdAt: Date };

export async function createPostDraft(input: CreatePostDraftInput): Promise<CreatePostDraftResult> {
  const existing = await prisma.postDraft.findFirst({
    where: {
      affiliateLink: input.affiliateLink,
      createdAt: { gte: startOfTodayInBrazil() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return { status: "duplicate", createdAt: existing.createdAt };
  }

  const category = input.category ?? categorize(input.title);
  const created = await prisma.postDraft.create({
    data: { ...input, category },
  });
  return { status: "created", id: created.id, category };
}

export async function listActivePostDrafts(): Promise<PostDraft[]> {
  return prisma.postDraft.findMany({
    where: { postedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export async function clearActivePostDrafts(): Promise<number> {
  const result = await prisma.postDraft.updateMany({
    where: { postedAt: null },
    data: { postedAt: new Date() },
  });
  return result.count;
}

export async function removePostDraft(id: string): Promise<boolean> {
  const result = await prisma.postDraft.updateMany({
    where: { id, postedAt: null },
    data: { postedAt: new Date() },
  });
  return result.count > 0;
}

export async function deleteStalePostDrafts(): Promise<number> {
  const result = await prisma.postDraft.deleteMany({
    where: { createdAt: { lt: startOfTodayInBrazil() } },
  });
  return result.count;
}

export async function getPostDraftById(id: string): Promise<PostDraft | null> {
  return withDbRetry(() => prisma.postDraft.findUnique({ where: { id } }));
}
