import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    loginAttempt: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { getClientIp, isRateLimited, recordFailedLoginAttempt } from "@/lib/loginRateLimit";

describe("getClientIp", () => {
  it("reads the first address from x-forwarded-for", () => {
    const request = new Request("http://localhost/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });
    expect(getClientIp(request)).toBe("203.0.113.5");
  });

  it("falls back to 'unknown' when the header is missing", () => {
    const request = new Request("http://localhost/api/auth/login");
    expect(getClientIp(request)).toBe("unknown");
  });
});

describe("isRateLimited", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T15:07:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("returns false when there is no record for the current window", async () => {
    vi.mocked(prisma.loginAttempt.findUnique).mockResolvedValue(null);

    expect(await isRateLimited("203.0.113.5")).toBe(false);
  });

  it("returns false when the count is under the limit", async () => {
    vi.mocked(prisma.loginAttempt.findUnique).mockResolvedValue({ count: 4 } as never);

    expect(await isRateLimited("203.0.113.5")).toBe(false);
  });

  it("returns true when the count reached the limit", async () => {
    vi.mocked(prisma.loginAttempt.findUnique).mockResolvedValue({ count: 5 } as never);

    expect(await isRateLimited("203.0.113.5")).toBe(true);
  });

  it("looks up the 15-minute window truncated to its start", async () => {
    vi.mocked(prisma.loginAttempt.findUnique).mockResolvedValue(null);

    await isRateLimited("203.0.113.5");

    expect(prisma.loginAttempt.findUnique).toHaveBeenCalledWith({
      where: {
        ip_windowStart: {
          ip: "203.0.113.5",
          windowStart: new Date("2026-08-03T15:00:00.000Z"),
        },
      },
    });
  });
});

describe("recordFailedLoginAttempt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T15:07:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("upserts the window row, incrementing the count on conflict", async () => {
    vi.mocked(prisma.loginAttempt.upsert).mockResolvedValue({} as never);

    await recordFailedLoginAttempt("203.0.113.5");

    expect(prisma.loginAttempt.upsert).toHaveBeenCalledWith({
      where: {
        ip_windowStart: {
          ip: "203.0.113.5",
          windowStart: new Date("2026-08-03T15:00:00.000Z"),
        },
      },
      create: { ip: "203.0.113.5", windowStart: new Date("2026-08-03T15:00:00.000Z"), count: 1 },
      update: { count: { increment: 1 } },
    });
  });
});
