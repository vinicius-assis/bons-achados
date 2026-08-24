# Paginação numerada da vitrine — Design

Data: 2026-08-24

## Objetivo

A vitrine pública (`/`) hoje só oferece "Página anterior" / "Próxima
página", sem indicação de quantas páginas existem nem forma de pular
direto para uma página específica. Trocar por uma paginação numerada
padrão: Primeira, ‹ Anterior, números de página (com reticências
quando houver muitas), Próxima ›, Última.

## Escopo

Só a vitrine pública (`src/app/page.tsx`). Nenhuma outra listagem do
projeto (hubs de admin, fila de postar) usa esse padrão de paginação
hoje — fora de escopo.

## Mudanças

### 1. Contagem total — `src/lib/highlights/store.ts`

`listHighlightsPage` hoje descobre se existe próxima página buscando
`pageSize + 1` linhas e checando se sobrou uma (`hasNextPage`). Isso
não dá o total de páginas, necessário para numerar.

Troca: rodar `prisma.highlight.count(...)` com o mesmo `where` em
paralelo com o `findMany` (via `Promise.all`), sem mais o truque do
`+1`:

```ts
export type ListHighlightsPageResult = {
  items: Highlight[];
  totalPages: number;
};

export async function listHighlightsPage(
  input: ListHighlightsPageInput
): Promise<ListHighlightsPageResult> {
  const { page, pageSize, marketplaces, q } = input;
  const trimmedQuery = q.trim();
  const where = {
    createdAt: { gte: startOfTodayInBrazil() },
    marketplace: { in: marketplaces },
    ...(trimmedQuery ? { title: { contains: trimmedQuery, mode: "insensitive" as const } } : {}),
  };

  const [rows, totalCount] = await Promise.all([
    prisma.highlight.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.highlight.count({ where }),
  ]);

  return { items: rows, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) };
}
```

`totalPages` nunca é menor que 1 (mesmo com zero resultados), para a
UI não precisar tratar "zero páginas" como caso especial.

Não há clamping de `page` contra `totalPages` — se o usuário pedir uma
página além do fim, `items` volta vazio, igual ao comportamento atual
para páginas sem resultados. Fora de escopo redirecionar/corrigir isso.

### 2. Janela de números — novo `src/lib/pagination.ts`

Função pura, sem dependência de Next/Prisma, para ficar isolada e
testável:

```ts
export type PageWindowItem = { type: "page"; page: number } | { type: "ellipsis" };

export function buildPageWindow(current: number, totalPages: number): PageWindowItem[]
```

Regras (padrão "janela ao redor da atual" tipo Google):

- Sempre inclui a primeira (`1`) e a última (`totalPages`) página.
- Inclui a janela `current - 1, current, current + 1` (clampada aos
  limites válidos).
- Onde há um buraco entre o que já foi incluído (ex.: entre `1` e
  `current - 1`), insere um único item `{ type: "ellipsis" }` — nunca
  reticências consecutivas, e nunca reticências cobrindo um buraco de
  tamanho 1 (nesse caso mostra o número em vez de "...").
- Se `totalPages` for pequeno o bastante para a janela cobrir tudo sem
  buracos, não aparece nenhuma reticência (todos os números aparecem).

Exemplos (`current`, `totalPages` → resultado):

- `(1, 3)` → `1 2 3`
- `(1, 10)` → `1 2 ... 10`
- `(6, 10)` → `1 ... 5 6 7 ... 10`
- `(9, 10)` → `1 ... 8 9 10`
- `(1, 1)` → `1`

### 3. UI — `src/app/page.tsx`

Bloco atual (linhas 100-119, só anterior/próxima) é substituído por:

- "Primeira" — link para página 1, só aparece se `page > 1`.
- "‹ Anterior" — link para `page - 1`, só aparece se `page > 1`.
- Números/reticências de `buildPageWindow(page, totalPages)`: cada
  `{ type: "page" }` vira um link via `buildPageHref` (já existe e
  preserva `filtered`/`marketplace`/`q`); a página atual é renderizada
  como texto destacado, não clicável. Cada `{ type: "ellipsis" }` vira
  um `<span>` não interativo com "...".
- "Próxima ›" — link para `page + 1`, só aparece se `page < totalPages`.
- "Última" — link para `totalPages`, só aparece se `page < totalPages`.

Todo o bloco de paginação só é renderizado se `totalPages > 1` (mesma
condição de hoje, adaptada). Mesmo estilo visual dos links atuais
(pill com borda, `font-mono text-xs uppercase`); página atual usa um
preenchimento sólido (`bg-ink text-paper`, por exemplo) para se
diferenciar dos links clicáveis.

Continua navegação via `<a href>` normal (sem JS), consistente com o
resto da página, que já é `force-dynamic` e não usa client-side
routing para os filtros.

## Testes

- `tests/lib/pagination.test.ts`: casos da tabela de exemplos acima
  mais casos de borda (`totalPages = 1`, `current` fora do intervalo
  válido não deveria acontecer mas não deve quebrar).
- `tests/lib/highlights/store.test.ts`: atualizar os testes existentes
  de `listHighlightsPage` que hoje verificam `hasNextPage` para
  verificar `totalPages` no lugar.
- Verificação manual no navegador: poucos itens (1 página, bloco some),
  itens suficientes para 2-3 páginas, e um teste com `PAGE_SIZE`
  temporariamente baixo (ou dados de teste) para checar reticências
  com muitas páginas.

## Fora de escopo

- Paginação numerada nos hubs de admin (Mercado Livre, Amazon, Shopee)
  ou na fila de postar — nenhum deles pagina hoje.
- Pular para página arbitrária via input de texto.
- Clamping/redirect quando `page` pedida excede `totalPages`.
