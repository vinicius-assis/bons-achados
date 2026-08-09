import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/highlights/store", () => ({
  createHighlight: vi.fn(),
  findHighlightByProductId: vi.fn(),
}));
vi.mock("@/lib/highlights/noteTemplates", () => ({
  pickRandomNote: vi.fn(() => "Nota de teste."),
}));
vi.mock("@/lib/postdraft/store", () => ({
  createPostDraft: vi.fn(),
}));

import { createHighlight, findHighlightByProductId } from "@/lib/highlights/store";
import { createPostDraft } from "@/lib/postdraft/store";
import { createManualItems, type ManualItemInput } from "@/lib/manualItems/createManualItems";

const AMAZON_ITEM: ManualItemInput = {
  imageLink: "https://img.example/1.webp",
  name: "Fone Bluetooth JBL",
  price: 199.9,
  discount: 20,
  affiliateLink: "https://www.amazon.com.br/dp/B08N5WRWNW?tag=x",
  addToPost: false,
};

const SHOPEE_ITEM: ManualItemInput = {
  imageLink: "https://img.example/2.webp",
  name: "Mochila antifurto",
  price: 89.9,
  discount: null,
  affiliateLink: "https://s.shopee.com.br/3LqZ9x8y",
  addToPost: true,
};

describe("createManualItems", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects the whole batch when any link is unrecognized, without writing anything", async () => {
    const badItem: ManualItemInput = { ...AMAZON_ITEM, affiliateLink: "https://example.com/x" };

    const result = await createManualItems([AMAZON_ITEM, badItem]);

    expect(result).toEqual({ ok: false, unrecognizedIndices: [1] });
    expect(createHighlight).not.toHaveBeenCalled();
  });

  it("creates a Highlight for each item and returns 'created' when addToPost is false", async () => {
    vi.mocked(findHighlightByProductId).mockResolvedValue(null);
    vi.mocked(createHighlight).mockResolvedValue({ id: "hl1" } as never);

    const result = await createManualItems([AMAZON_ITEM]);

    expect(createHighlight).toHaveBeenCalledWith({
      marketplace: "AMAZON",
      productId: "B08N5WRWNW",
      title: "Fone Bluetooth JBL",
      note: "Nota de teste.",
      affiliateLink: AMAZON_ITEM.affiliateLink,
      image: AMAZON_ITEM.imageLink,
      price: 199.9,
      oldPrice: null,
      discount: 20,
    });
    expect(createPostDraft).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, results: [{ status: "created", id: "hl1" }] });
  });

  it("also creates a PostDraft and returns 'created_and_queued' when addToPost is true", async () => {
    vi.mocked(findHighlightByProductId).mockResolvedValue(null);
    vi.mocked(createHighlight).mockResolvedValue({ id: "hl2" } as never);
    vi.mocked(createPostDraft).mockResolvedValue({
      status: "created",
      id: "pd1",
      category: "outro",
    });

    const result = await createManualItems([SHOPEE_ITEM]);

    expect(createPostDraft).toHaveBeenCalledWith({
      marketplace: "SHOPEE",
      source: "MANUAL",
      title: "Mochila antifurto",
      imageTitle: "Mochila antifurto",
      affiliateLink: SHOPEE_ITEM.affiliateLink,
      image: SHOPEE_ITEM.imageLink,
      price: 89.9,
      discount: null,
      category: null,
    });
    expect(result).toEqual({
      ok: true,
      results: [{ status: "created_and_queued", id: "hl2", postDraftId: "pd1" }],
    });
  });

  it("skips creating a Highlight and returns 'duplicate' when one already exists, without blocking other items", async () => {
    vi.mocked(findHighlightByProductId).mockImplementation(async (_marketplace, productId) =>
      productId === "B08N5WRWNW" ? ({ id: "existing" } as never) : null
    );
    vi.mocked(createHighlight).mockResolvedValue({ id: "hl-shopee" } as never);
    vi.mocked(createPostDraft).mockResolvedValue({
      status: "created",
      id: "pd1",
      category: "outro",
    });

    const result = await createManualItems([AMAZON_ITEM, SHOPEE_ITEM]);

    expect(createHighlight).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      results: [
        { status: "duplicate" },
        { status: "created_and_queued", id: "hl-shopee", postDraftId: "pd1" },
      ],
    });
  });

  it("falls back to 'created' when addToPost is true but the PostDraft turns out to be a duplicate", async () => {
    vi.mocked(findHighlightByProductId).mockResolvedValue(null);
    vi.mocked(createHighlight).mockResolvedValue({ id: "hl3" } as never);
    vi.mocked(createPostDraft).mockResolvedValue({
      status: "duplicate",
      createdAt: new Date("2026-08-09T12:00:00.000Z"),
    });

    const result = await createManualItems([SHOPEE_ITEM]);

    expect(result).toEqual({ ok: true, results: [{ status: "created", id: "hl3" }] });
  });
});
