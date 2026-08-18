import { prisma } from "@/lib/prisma";

export type AmazonHubSession = {
  cookieHeader: string;
};

export async function getSession(): Promise<AmazonHubSession | null> {
  const row = await prisma.amazonSession.findUnique({ where: { id: 1 } });
  if (!row) {
    return null;
  }
  return { cookieHeader: row.cookieHeader };
}

export async function saveSession(cookieHeader: string): Promise<void> {
  await prisma.amazonSession.upsert({
    where: { id: 1 },
    create: { id: 1, cookieHeader },
    update: { cookieHeader },
  });
}
