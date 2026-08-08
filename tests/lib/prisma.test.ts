import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";

describe("prisma client", () => {
  it("exports a singleton PrismaClient instance", () => {
    expect(prisma).toBeDefined();
  });
});
