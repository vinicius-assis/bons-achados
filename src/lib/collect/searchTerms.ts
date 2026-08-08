// Fixed pool of generic Brazilian e-commerce categories. Each collection
// cycle for Mercado Livre and Shopee samples one at random — editable here,
// no admin UI for this list (see docs/superpowers/specs/2026-08-07-vitrine-automatica-design.md).
export const SEARCH_TERMS: string[] = [
  "eletrônicos",
  "celular",
  "informática",
  "casa",
  "cozinha",
  "beleza",
  "moda",
  "calçados",
  "esporte",
  "brinquedos",
  "livros",
  "bebê",
  "pet",
  "ferramentas",
  "automotivo",
  "games",
  "som e áudio",
  "decoração",
  "papelaria",
  "saúde",
];

export function pickRandomSearchTerm(): string {
  return SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
}
