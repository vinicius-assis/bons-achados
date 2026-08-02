import { describe, it, expect, vi } from "vitest";
import { upsertProducts } from "@/lib/products/upsert";
import { prisma } from "@/lib/prisma";
import type { ProductInput } from "@/lib/products/types";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

const product: ProductInput = {
  marketplace: "MERCADO_LIVRE",
  source: "AUTO",
  productId: "MLB1",
  title: "Echo Dot",
  description: null,
  price: 219,
  oldPrice: 399,
  discount: 45,
  rating: 4.8,
  reviews: 24000,
  image: "http://img",
  affiliateLink: "http://item?matt_word=x&matt_tool=1",
  category: "MLB1000",
  seller: "Loja",
};

describe("upsertProducts", () => {
  it("upserts each product by marketplace and productId", async () => {
    const count = await upsertProducts([product]);

    expect(prisma.product.upsert).toHaveBeenCalledWith({
      where: {
        marketplace_productId: { marketplace: "MERCADO_LIVRE", productId: "MLB1" },
      },
      create: product,
      update: {
        title: product.title,
        price: product.price,
        oldPrice: product.oldPrice,
        discount: product.discount,
        rating: product.rating,
        reviews: product.reviews,
        image: product.image,
        affiliateLink: product.affiliateLink,
      },
    });
    expect(count).toBe(1);
  });

  it("returns 0 for an empty product list", async () => {
    vi.mocked(prisma.product.upsert).mockClear();
    const count = await upsertProducts([]);
    expect(count).toBe(0);
  });
});
