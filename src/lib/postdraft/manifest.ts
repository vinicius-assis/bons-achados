import type { Marketplace } from "@prisma/client";

// Contract: docs/superpowers/specs — "Contrato de exportação — Lote de Stories".
// This module owns the pure parts: slugging image names, mapping the sticker
// text, and validating the batch. The route composes the images and zips.

const MAX_SLUG_LENGTH = 40;

const STICKER_TEXT: Record<Marketplace, string> = {
  MERCADO_LIVRE: "Meli",
  AMAZON: "Amazon",
  SHOPEE: "Shopee",
};

export type ManifestDraft = {
  id: string;
  title: string;
  affiliateLink: string;
  marketplace: Marketplace;
};

export type ManifestStory = {
  id: string;
  imagem: string;
  link: string;
  texto_sticker: string;
};

export type StoryManifest = {
  versao: 1;
  gerado_em: string;
  stories: ManifestStory[];
};

export class ManifestValidationError extends Error {
  detalhes: string[];

  constructor(detalhes: string[]) {
    super(detalhes.join("; "));
    this.name = "ManifestValidationError";
    this.detalhes = detalhes;
  }
}

export function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || "story";
}

export function buildStoryManifest(drafts: ManifestDraft[], generatedAt: Date): StoryManifest {
  const detalhes: string[] = [];

  if (drafts.length === 0) {
    throw new ManifestValidationError(["a lista de stories está vazia"]);
  }

  const seen = new Set<string>();
  const pad = Math.max(3, String(drafts.length).length);
  const stories: ManifestStory[] = drafts.map((draft, index) => {
    const position = index + 1;
    if (seen.has(draft.id)) {
      detalhes.push(`story ${position}: id "${draft.id}" repetido`);
    }
    seen.add(draft.id);

    if (!draft.affiliateLink.startsWith("https://")) {
      detalhes.push(`story ${position}: link inválido (precisa começar com https://)`);
    }

    const order = String(position).padStart(pad, "0");
    return {
      id: draft.id,
      imagem: `${order}-${slugifyTitle(draft.title)}.jpg`,
      link: draft.affiliateLink,
      texto_sticker: STICKER_TEXT[draft.marketplace],
    };
  });

  if (detalhes.length > 0) {
    throw new ManifestValidationError(detalhes);
  }

  return {
    versao: 1,
    gerado_em: generatedAt.toISOString(),
    stories,
  };
}
