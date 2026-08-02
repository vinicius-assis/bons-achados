import type { MLSearchItem, MLReviews } from "@/lib/mercadolivre/client";
import type { ProductInput } from "@/lib/products/types";

function buildAffiliateLink(permalink: string): string {
  const affiliateWord = process.env.ML_AFFILIATE_WORD;
  const affiliateTool = process.env.ML_AFFILIATE_TOOL;
  if (!affiliateWord || !affiliateTool) {
    throw new Error("Missing ML_AFFILIATE_WORD or ML_AFFILIATE_TOOL env vars");
  }
  const separator = permalink.includes("?") ? "&" : "?";
  return `${permalink}${separator}matt_word=${affiliateWord}&matt_tool=${affiliateTool}`;
}

function calculateDiscount(price: number, originalPrice: number | null): number | null {
  if (!originalPrice || originalPrice <= price) {
    return null;
  }
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

export function mapToProductInput(item: MLSearchItem, reviews: MLReviews): ProductInput {
  return {
    marketplace: "MERCADO_LIVRE",
    source: "AUTO",
    productId: item.id,
    title: item.title,
    description: null,
    price: item.price,
    oldPrice: item.original_price,
    discount: calculateDiscount(item.price, item.original_price),
    rating: reviews.rating_average || null,
    reviews: reviews.total || null,
    image: item.thumbnail,
    affiliateLink: buildAffiliateLink(item.permalink),
    category: item.category_id,
    seller: item.seller?.nickname ?? null,
  };
}
