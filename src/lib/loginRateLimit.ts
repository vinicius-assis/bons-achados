import { prisma } from "@/lib/prisma";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

function currentWindowStart(): Date {
  const now = Date.now();
  return new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

export async function isRateLimited(ip: string): Promise<boolean> {
  const windowStart = currentWindowStart();
  const attempt = await prisma.loginAttempt.findUnique({
    where: { ip_windowStart: { ip, windowStart } },
  });
  return (attempt?.count ?? 0) >= MAX_ATTEMPTS_PER_WINDOW;
}

export async function recordFailedLoginAttempt(ip: string): Promise<void> {
  const windowStart = currentWindowStart();
  await prisma.loginAttempt.upsert({
    where: { ip_windowStart: { ip, windowStart } },
    create: { ip, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });
}
