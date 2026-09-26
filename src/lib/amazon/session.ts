import { prisma } from "@/lib/prisma";

export async function getAmazonWebCookie(): Promise<string | null> {
  const row = await prisma.amazonWebSession.findUnique({ where: { id: 1 } });
  return row?.cookieHeader ?? null;
}

export async function saveAmazonWebCookie(cookieHeader: string): Promise<void> {
  await prisma.amazonWebSession.upsert({
    where: { id: 1 },
    create: { id: 1, cookieHeader },
    update: { cookieHeader },
  });
}
