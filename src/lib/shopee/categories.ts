// Shopee's affiliate API doesn't expose a category-list endpoint. This is the
// top-level (productCatId level 1) taxonomy, captured live on 2026-08-17 by
// resolving each category's productCatIds[0] from real productOfferV2
// results. No admin UI edits this — update here if Shopee changes their
// categories.
export const SHOPEE_HUB_CATEGORIES: { id: string; name: string }[] = [
  { id: "100009", name: "Acessórios de Moda" },
  { id: "100631", name: "Animais Domésticos" },
  { id: "100640", name: "Automóveis" },
  { id: "100630", name: "Beleza" },
  { id: "100016", name: "Bolsas Femininas" },
  { id: "100533", name: "Bolsas Masculinas" },
  { id: "100635", name: "Câmeras e Drones" },
  { id: "100636", name: "Casa e Decoração" },
  { id: "100013", name: "Celulares e Dispositivos" },
  { id: "100644", name: "Computadores e Acessórios" },
  { id: "100010", name: "Eletrodomésticos" },
  { id: "100637", name: "Esportes e Atividades ao Ar Livre" },
  { id: "100639", name: "Hobbies e Coleções" },
  { id: "100634", name: "Jogos e Consoles" },
  { id: "100643", name: "Livros e Revistas" },
  { id: "100632", name: "Mãe e Bebê" },
  { id: "100633", name: "Moda Infantil" },
  { id: "100638", name: "Papelaria" },
  { id: "100534", name: "Relógios" },
  { id: "100017", name: "Roupas Femininas" },
  { id: "100011", name: "Roupas Masculinas" },
  { id: "100001", name: "Saúde" },
  { id: "100532", name: "Sapatos Femininos" },
  { id: "100012", name: "Sapatos Masculinos" },
  { id: "100015", name: "Viagens e Bagagens" },
];
