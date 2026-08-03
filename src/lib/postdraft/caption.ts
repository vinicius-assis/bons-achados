export type CaptionProduct = {
  title: string;
  marketplace: "MERCADO_LIVRE" | "AMAZON" | "SHOPEE";
  category: string | null;
  discount: number | null;
};

const BASE_HASHTAGS = [
  "#achados",
  "#promocao",
  "#promocoes",
  "#ofertas",
  "#ofertadodia",
  "#descontos",
  "#compraonline",
  "#bonsachados",
];

const MARKETPLACE_HASHTAGS: Record<CaptionProduct["marketplace"], string> = {
  MERCADO_LIVRE: "#mercadolivre",
  AMAZON: "#amazon",
  SHOPEE: "#shopee",
};

const CATEGORY_HASHTAGS: Record<string, string[]> = {
  roupa: ["#moda", "#roupas"],
  suplemento: ["#suplementos", "#fitness"],
  casa: ["#casa", "#organizacao"],
  beleza: ["#beleza"],
  fitness: ["#fitness", "#treino"],
  bebida: ["#bebidas"],
};

function shortName(name: string, maxLength = 60): string {
  const head = name.split(" | ")[0].trim();
  if (head.length <= maxLength) {
    return head;
  }
  const cut = head.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace === -1 ? cut : cut.slice(0, lastSpace)).trim()}...`;
}

function discountText(discount: number | null): string {
  return discount ? `${discount}% OFF` : "imperdivel";
}

export function buildCaption(products: CaptionProduct[]): string {
  const lines = ["🚨 ALERTA DE PROMOÇÃO 🚨", ""];
  products.forEach((product, index) => {
    lines.push(`🔥 ${index + 1}. ${shortName(product.title)} — ${discountText(product.discount)}`);
  });
  lines.push("");
  lines.push("Corre que promoção boa não espera 🏃‍♂️💨");
  lines.push("👉 Link de cada produto nos Stories");
  lines.push("");

  const hashtags = [...BASE_HASHTAGS];

  const marketplaces = new Set(products.map((product) => product.marketplace));
  for (const marketplace of marketplaces) {
    const tag = MARKETPLACE_HASHTAGS[marketplace];
    if (tag && !hashtags.includes(tag)) {
      hashtags.push(tag);
    }
  }

  const categories = new Set(
    products.map((product) => product.category).filter((category): category is string => Boolean(category))
  );
  for (const category of categories) {
    for (const tag of CATEGORY_HASHTAGS[category] ?? []) {
      if (!hashtags.includes(tag)) {
        hashtags.push(tag);
      }
    }
  }

  lines.push(hashtags.join(" "));
  return `${lines.join("\n")}\n`;
}
