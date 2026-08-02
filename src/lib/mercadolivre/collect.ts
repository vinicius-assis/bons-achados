import { MercadoLivreClient } from "@/lib/mercadolivre/client";
import { mapToProductInput } from "@/lib/mercadolivre/mapper";
import type { ProductInput } from "@/lib/products/types";

export async function collectMercadoLivreDeals(
  queries: string[],
  client: MercadoLivreClient
): Promise<ProductInput[]> {
  const products: ProductInput[] = [];
  for (const query of queries) {
    try {
      const items = await client.searchProducts(query);
      for (const item of items) {
        const reviews = await client.getItemReviews(item.id);
        products.push(mapToProductInput(item, reviews));
      }
    } catch (error) {
      console.error(`Mercado Livre collection failed for query "${query}":`, error);
    }
  }
  return products;
}
