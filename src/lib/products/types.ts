export type Marketplace = "MERCADO_LIVRE" | "AMAZON" | "SHOPEE";
export type ProductSource = "AUTO" | "MANUAL";

export type ProductInput = {
  marketplace: Marketplace;
  source: ProductSource;
  productId: string;
  title: string;
  description: string | null;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  rating: number | null;
  reviews: number | null;
  image: string;
  affiliateLink: string;
  category: string | null;
  seller: string | null;
};
