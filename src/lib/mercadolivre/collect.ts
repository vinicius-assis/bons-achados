import { MercadoLivreClient } from "@/lib/mercadolivre/client";
import { mapToProductInput } from "@/lib/mercadolivre/mapper";
import type { ProductInput } from "@/lib/products/types";

export type CollectResult = {
  products: ProductInput[];
  failedQueries: number;
};

export async function collectMercadoLivreDeals(
  queries: string[],
  client: MercadoLivreClient
): Promise<CollectResult> {
  const products: ProductInput[] = [];
  let failedQueries = 0;
  for (const query of queries) {
    try {
      const items = await client.searchProducts(query);
      for (const item of items) {
        const reviews = await client.getItemReviews(item.id);
        products.push(mapToProductInput(item, reviews));
      }
    } catch (error) {
      failedQueries += 1;
      console.error(`Mercado Livre collection failed for query "${query}":`, error);
    }
  }
  return { products, failedQueries };
}
