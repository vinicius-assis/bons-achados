import type { Marketplace } from "@prisma/client";
import { createHighlight, findHighlightByProductId } from "@/lib/highlights/store";
import { pickRandomNote } from "@/lib/highlights/noteTemplates";
import { createPostDraft } from "@/lib/postdraft/store";
import { detectMarketplace, extractProductId } from "@/lib/manualItems/detectMarketplace";

export type ManualItemInput = {
  imageLink: string;
  name: string;
  price: number;
  discount: number | null;
  affiliateLink: string;
  addToPost: boolean;
};

export type ManualItemResult =
  | { status: "created"; id: string }
  | { status: "created_and_queued"; id: string; postDraftId: string }
  | { status: "duplicate" };

export type CreateManualItemsResult =
  | { ok: false; unrecognizedIndices: number[] }
  | { ok: true; results: ManualItemResult[] };

export async function createManualItems(
  items: ManualItemInput[]
): Promise<CreateManualItemsResult> {
  const detected = items.map((item) => detectMarketplace(item.affiliateLink));
  const unrecognizedIndices = detected
    .map((marketplace, index) => (marketplace === null ? index : -1))
    .filter((index) => index !== -1);

  if (unrecognizedIndices.length > 0) {
    return { ok: false, unrecognizedIndices };
  }

  const results: ManualItemResult[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const marketplace = detected[index] as Marketplace;
    const productId = extractProductId(marketplace, item.affiliateLink);

    const existing = await findHighlightByProductId(marketplace, productId);
    if (existing) {
      results.push({ status: "duplicate" });
      continue;
    }

    const highlight = await createHighlight({
      marketplace,
      productId,
      title: item.name,
      note: pickRandomNote(),
      affiliateLink: item.affiliateLink,
      image: item.imageLink,
      price: item.price,
      oldPrice: null,
      discount: item.discount,
    });

    if (!item.addToPost) {
      results.push({ status: "created", id: highlight.id });
      continue;
    }

    const postDraftResult = await createPostDraft({
      marketplace,
      source: "MANUAL",
      title: item.name,
      imageTitle: item.name,
      affiliateLink: item.affiliateLink,
      image: item.imageLink,
      price: item.price,
      discount: item.discount,
      category: null,
    });

    if (postDraftResult.status === "duplicate") {
      results.push({ status: "created", id: highlight.id });
      continue;
    }

    results.push({
      status: "created_and_queued",
      id: highlight.id,
      postDraftId: postDraftResult.id,
    });
  }

  return { ok: true, results };
}
