import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";

describe("prisma client", () => {
  it("exports a singleton PrismaClient instance with the Product model", () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.product.upsert).toBe("function");
  });
});
