import { prisma } from "@/lib/prisma";
import type { ProductInput } from "@/lib/products/types";

export async function upsertProducts(products: ProductInput[]): Promise<number> {
  let count = 0;
  for (const product of products) {
    await prisma.product.upsert({
      where: {
        marketplace_productId: {
          marketplace: product.marketplace,
          productId: product.productId,
        },
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
    count += 1;
  }
  return count;
}
