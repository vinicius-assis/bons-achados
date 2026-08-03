import type { Marketplace, PostDraft, ProductSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { categorize } from "@/lib/postdraft/categorize";

const BRAZIL_UTC_OFFSET_MS = -3 * 60 * 60 * 1000; // fixed offset, Brazil has not observed DST since 2019

function startOfTodayInBrazil(now: Date = new Date()): Date {
  const brazilNow = new Date(now.getTime() + BRAZIL_UTC_OFFSET_MS);
  const startOfDayBrazilMs = Date.UTC(
    brazilNow.getUTCFullYear(),
    brazilNow.getUTCMonth(),
    brazilNow.getUTCDate()
  );
  return new Date(startOfDayBrazilMs - BRAZIL_UTC_OFFSET_MS);
}

export type CreatePostDraftInput = {
  marketplace: Marketplace;
  source: ProductSource;
  title: string;
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

export async function deleteStalePostDrafts(): Promise<number> {
  const result = await prisma.postDraft.deleteMany({
    where: { createdAt: { lt: startOfTodayInBrazil() } },
  });
  return result.count;
}

export async function getPostDraftById(id: string): Promise<PostDraft | null> {
  return prisma.postDraft.findUnique({ where: { id } });
}
