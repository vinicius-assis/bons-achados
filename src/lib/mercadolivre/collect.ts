import { MercadoLivreClient } from "@/lib/mercadolivre/client";
import { mapToProductInput } from "@/lib/mercadolivre/mapper";
import type { ProductInput } from "@/lib/products/types";

export async function collectMercadoLivreDeals(
  queries: string[],
  client: MercadoLivreClient = new MercadoLivreClient()
): Promise<ProductInput[]> {
  const products: ProductInput[] = [];
  for (const query of queries) {
    const items = await client.searchProducts(query);
    for (const item of items) {
      const reviews = await client.getItemReviews(item.id);
      products.push(mapToProductInput(item, reviews));
    }
  }
  return products;
}
