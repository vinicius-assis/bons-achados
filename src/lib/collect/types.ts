export type CollectItem = {
  productId: string;
  title: string;
  affiliateLink: string;
  image: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
};

export type CollectResult = {
  attempted: number;
  inserted: number;
  skipped: number;
  error?: string;
};
