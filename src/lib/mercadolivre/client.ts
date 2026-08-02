const ML_API_BASE = "https://api.mercadolibre.com";

export type MLSearchItem = {
  id: string;
  title: string;
  price: number;
  original_price: number | null;
  thumbnail: string;
  permalink: string;
  category_id: string;
  seller: { nickname: string } | null;
  sold_quantity: number;
};

export type MLReviews = {
  rating_average: number;
  total: number;
};

export class MercadoLivreClient {
  async searchProducts(query: string): Promise<MLSearchItem[]> {
    const url = `${ML_API_BASE}/sites/MLB/search?q=${encodeURIComponent(query)}&limit=20`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Mercado Livre search failed: ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data.results) ? (data.results as MLSearchItem[]) : [];
  }

  async getItemReviews(itemId: string): Promise<MLReviews> {
    const url = `${ML_API_BASE}/reviews/item/${itemId}`;
    const response = await fetch(url);
    if (!response.ok) {
      return { rating_average: 0, total: 0 };
    }
    const data = await response.json();
    return {
      rating_average: data.rating_average ?? 0,
      total: data.paging?.total ?? 0,
    };
  }
}
