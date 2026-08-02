import { prisma } from "@/lib/prisma";

export type MLHubSession = {
  cookieHeader: string;
  csrfToken: string;
};

export async function getSession(): Promise<MLHubSession | null> {
  const row = await prisma.mercadoLivreSession.findUnique({ where: { id: 1 } });
  if (!row) {
    return null;
  }
  return { cookieHeader: row.cookieHeader, csrfToken: row.csrfToken };
}

export async function saveSession(cookieHeader: string, csrfToken: string): Promise<void> {
  await prisma.mercadoLivreSession.upsert({
    where: { id: 1 },
    create: { id: 1, cookieHeader, csrfToken },
    update: { cookieHeader, csrfToken },
  });
}
