import type { Marketplace } from "@prisma/client";

const PATTERNS: Array<[Marketplace, RegExp]> = [
  ["MERCADO_LIVRE", /^https:\/\/meli\.la\//],
  ["SHOPEE", /^https:\/\/s\.shopee\.com\.br\//],
  ["AMAZON", /^https:\/\/www\.amazon\.com\.br\/dp\//],
];

export function detectMarketplace(affiliateLink: string): Marketplace | null {
  const match = PATTERNS.find(([, pattern]) => pattern.test(affiliateLink));
  return match ? match[0] : null;
}

const ID_PATTERNS: Record<Marketplace, RegExp> = {
  AMAZON: /\/dp\/([A-Za-z0-9]+)/,
  SHOPEE: /^https:\/\/s\.shopee\.com\.br\/([^/?#]+)/,
  MERCADO_LIVRE: /^https:\/\/meli\.la\/([^/?#]+)/,
};

export function extractProductId(marketplace: Marketplace, affiliateLink: string): string {
  const match = affiliateLink.match(ID_PATTERNS[marketplace]);
  return match ? match[1] : crypto.randomUUID();
}
