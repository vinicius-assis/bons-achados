const CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  ["suplemento", ["creatina", "suplemento", "whey", "proteina", "bcaa"]],
  [
    "roupa",
    ["camiseta", "camisetas", "cueca", "cuecas", "bermuda", "shorts", "body", "calca", "vestido"],
  ],
  [
    "casa",
    [
      "fritadeira",
      "micro-ondas",
      "microondas",
      "sanduicheira",
      "pote",
      "potes",
      "filtro de agua",
      "papel higienico",
      "camera",
      "lampada",
    ],
  ],
  [
    "beleza",
    ["serum", "niacinamida", "escova secadora", "aparador de pelos", "kit essencial"],
  ],
  ["fitness", ["bicicleta", "spinning", "ergometrica", "esteira"]],
  ["bebida", ["cerveja", "heineken", "refrigerante", "vinho"]],
];

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function categorize(name: string): string {
  const normalized = normalize(name);
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) {
        return category;
      }
    }
  }
  return "outro";
}
