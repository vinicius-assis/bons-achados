import { describe, it, expect } from "vitest";
import {
  buildStoryManifest,
  ManifestValidationError,
  slugifyTitle,
} from "@/lib/postdraft/manifest";

type Draft = Parameters<typeof buildStoryManifest>[0][number];

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: "cd1",
    title: "Tênis Branco Casual",
    affiliateLink: "https://bonsachados.links/r/10482",
    marketplace: "MERCADO_LIVRE",
    ...overrides,
  };
}

describe("slugifyTitle", () => {
  it("strips accents, lowercases, and joins words with dashes", () => {
    expect(slugifyTitle("Tênis Branco Casual")).toBe("tenis-branco-casual");
  });

  it("falls back to 'story' when nothing usable remains", () => {
    expect(slugifyTitle("!!! ***")).toBe("story");
  });

  it("caps length at 40 characters without a trailing dash", () => {
    const slug = slugifyTitle("a".repeat(30) + " " + "b".repeat(30));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("buildStoryManifest", () => {
  it("builds a versioned manifest with numbered image names in list order", () => {
    const manifest = buildStoryManifest(
      [
        draft({ id: "cd1", title: "Tênis Branco", marketplace: "MERCADO_LIVRE" }),
        draft({ id: "cd2", title: "Fone Bluetooth", marketplace: "AMAZON" }),
      ],
      new Date("2026-08-29T14:30:00-03:00")
    );

    expect(manifest.versao).toBe(1);
    // Contract v2 dropped sticker_y_ratio — the script ignores it, so we don't send it.
    expect(manifest).not.toHaveProperty("defaults");
    expect(manifest.stories).toEqual([
      {
        id: "cd1",
        imagem: "001-tenis-branco.jpg",
        link: "https://bonsachados.links/r/10482",
        texto_sticker: "Meli",
      },
      {
        id: "cd2",
        imagem: "002-fone-bluetooth.jpg",
        link: "https://bonsachados.links/r/10482",
        texto_sticker: "Amazon",
      },
    ]);
  });

  it("maps SHOPEE drafts to the Shopee sticker text", () => {
    const manifest = buildStoryManifest([draft({ marketplace: "SHOPEE" })], new Date());
    expect(manifest.stories[0].texto_sticker).toBe("Shopee");
  });

  it("does not emit sticker_y_ratio anywhere", () => {
    const manifest = buildStoryManifest([draft()], new Date());
    expect(JSON.stringify(manifest)).not.toContain("sticker_y_ratio");
  });

  it("rejects an empty draft list", () => {
    expect(() => buildStoryManifest([], new Date())).toThrow(ManifestValidationError);
  });

  it("rejects duplicate draft ids", () => {
    expect(() =>
      buildStoryManifest([draft({ id: "dup" }), draft({ id: "dup" })], new Date())
    ).toThrow(ManifestValidationError);
  });

  it("rejects a link that is not https", () => {
    try {
      buildStoryManifest([draft({ affiliateLink: "http://insecure.example" })], new Date());
      throw new Error("expected ManifestValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestValidationError);
      expect((error as ManifestValidationError).detalhes[0]).toMatch(/story 1/);
    }
  });
});
