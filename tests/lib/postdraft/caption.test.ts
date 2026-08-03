import { describe, it, expect } from "vitest";
import { buildCaption, type CaptionProduct } from "@/lib/postdraft/caption";

describe("buildCaption", () => {
  it("numbers each product with its discount and appends hashtags", () => {
    const products: CaptionProduct[] = [
      { title: "Creatina 1kg Suplemento", marketplace: "MERCADO_LIVRE", category: "suplemento", discount: 72 },
      { title: "Air Fryer 5L", marketplace: "AMAZON", category: "casa", discount: null },
    ];

    const caption = buildCaption(products);

    expect(caption).toContain("🔥 1. Creatina 1kg Suplemento — 72% OFF");
    expect(caption).toContain("🔥 2. Air Fryer 5L — imperdivel");
    expect(caption).toContain("#mercadolivre");
    expect(caption).toContain("#amazon");
    expect(caption).toContain("#suplementos");
    expect(caption).toContain("#casa");
    expect(caption).toContain("#bonsachados");
  });

  it("truncates long titles at a word boundary and drops anything after ' | '", () => {
    const longTitle =
      "Fone de Ouvido Bluetooth 5.4 com Cancelamento de Ruído Adaptativo e Estojo | Cor Preta";
    const products: CaptionProduct[] = [
      { title: longTitle, marketplace: "AMAZON", category: null, discount: 10 },
    ];

    const caption = buildCaption(products);

    expect(caption).not.toContain("Cor Preta");
    expect(caption).toContain("...");
  });

  it("does not duplicate a hashtag shared by two products", () => {
    const products: CaptionProduct[] = [
      { title: "Camiseta A", marketplace: "MERCADO_LIVRE", category: "roupa", discount: 20 },
      { title: "Camiseta B", marketplace: "MERCADO_LIVRE", category: "roupa", discount: 30 },
    ];

    const caption = buildCaption(products);
    const occurrences = caption.split("#mercadolivre").length - 1;

    expect(occurrences).toBe(1);
  });
});
