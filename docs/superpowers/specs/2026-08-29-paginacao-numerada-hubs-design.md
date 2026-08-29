# Paginação numerada nos hubs de admin — Design

Data: 2026-08-29

## Objetivo

Os três hubs de admin (`/admin/mercadolivre`, `/admin/amazon`,
`/admin/shopee`) hoje não têm paginação consistente:

- **Lista inicial (pool do banco):** `loadPool()` chama
  `GET /api/admin/highlights?marketplace=X` e despeja **todos** os
  destaques coletados hoje de uma vez, sem limite nem navegação.
- **Busca ao vivo com filtro:** Mercado Livre e Shopee têm um botão
  "Carregar mais" (append, `offset`/`page`); Amazon não tem paginação
  nenhuma — sempre a página 1 (10 itens).

Trocar por paginação **numerada** (‹ Anterior, números de página,
Próxima ›) nos dois contextos, nos três hubs.

## Contexto: o que as APIs upstream informam

| Marketplace | Total de resultados? | Sinal de "tem próxima"? | Tamanho de página |
|---|---|---|---|
| Banco (pool) | Sim — `prisma.highlight.count()` | — | 30 (definido por nós) |
| Mercado Livre | Não | Página cheia (`fetchedCount >= 18`) | 18 (ditado pela API) |
| Shopee | Não | `pageInfo.hasNextPage` | 20 (ditado pela API) |
| Amazon | Não lido (PA-API tem teto ~10 páginas) | `items.length >= 10` | 10 (ditado pela API) |

Consequência de design: **duas modalidades de pager**.

- **Modo exato** — só o pool do banco. Sabemos `totalPages`, então
  mostramos "Primeira / ‹ Anterior / 1 2 … 12 13 / Próxima › / Última",
  com reticências, exatamente como a vitrine pública.
- **Modo janela** — qualquer busca/filtro ao vivo. Não sabemos onde
  acaba. Mostramos `1 … maior página já visitada`, sem "Primeira"/
  "Última", com "Próxima ›" habilitada apenas enquanto a API sinalizar
  que há mais. Navegação adiante é sempre um passo por vez; voltar para
  uma página já visitada é permitido (refaz o fetch daquela página).

## Escopo

Os três componentes client de admin (`MercadoLivreAdmin`,
`AmazonAdmin`, `ShopeeAdmin`), a rota `GET /api/admin/highlights`, a
rota `GET /api/admin/amazon/search` (wiring de `page`) e um novo
componente de pager client.

**Fora de escopo:** vitrine pública (já tem paginação), fila de postar,
input de "pular para página N", ler `TotalResultCount` da Amazon,
qualquer mudança nos `hubClient.ts` (as funções de busca já aceitam
`offset`/`page`).

## Mudanças

### 1. Novo componente — `src/components/HubPager.tsx`

Client component. A lógica de pager existe hoje só em
`VitrineResults.tsx` como server component com `<a href>`; os hubs são
client components que fazem `fetch`, então precisam de um pager que
dispare um callback.

```ts
type HubPagerProps = {
  currentPage: number;
  lastKnownPage: number;   // modo exato: totalPages; modo janela: maior página vista
  hasNext: boolean;        // modo exato: currentPage < totalPages; modo janela: sinal da API
  exact: boolean;          // true = mostra "Primeira"/"Última" e reticências à direita
  disabled: boolean;       // durante carregamento
  onPageChange: (page: number) => void;
};

export default function HubPager(props: HubPagerProps): JSX.Element | null;
```

Comportamento:

- Reusa `buildPageWindow(currentPage, lastKnownPage)` de
  `src/lib/pagination.ts` para a fileira de números/reticências.
- `exact === true`: renderiza "Primeira" e "‹ Anterior" quando
  `currentPage > 1`; "Próxima ›" e "Última" quando `hasNext`. A janela
  de `buildPageWindow` já cobre reticências dos dois lados.
- `exact === false` (janela): sem "Primeira"/"Última". "‹ Anterior"
  quando `currentPage > 1`. "Próxima ›" apenas quando `hasNext`. Como
  `lastKnownPage` é a maior página vista e `buildPageWindow` sempre
  inclui `1` e `lastKnownPage`, o resultado natural é `1 … N-1 N`.
- Não renderiza nada (`return null`) quando `exact && lastKnownPage <= 1
  && !hasNext` (uma página só, sem navegação).
- `disabled`: todos os controles com `disabled`, opacidade 50%,
  `cursor-not-allowed`.
- A página atual é um `<span aria-current="page">` não clicável.
- `onPageChange` nunca é chamado para a página atual nem fora do
  intervalo `[1, hasNext ? lastKnownPage + 1 : lastKnownPage]`.

Estilo (paleta escura dos hubs, equivalente ao pager claro da vitrine):

- Botão/número clicável: `rounded-full border border-ink-line
  bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper
  uppercase transition hover:border-gold hover:text-gold
  focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none`.
- Página atual: `rounded-full bg-gold px-4 py-2 font-mono text-xs
  tracking-wider text-ink uppercase`.
- Reticências: `px-2 py-2 font-mono text-xs tracking-wider text-ash`.
- Contêiner: `<nav aria-label="Paginação">` com `mt-10 flex flex-wrap
  items-center justify-center gap-2`, renderizado depois do grid.

Ao trocar de página, o hub rola a lista para o topo
(`window.scrollTo({ top: 0, behavior: "smooth" })` no handler, junto
com a chamada de fetch).

### 2. Paginação do pool — `GET /api/admin/highlights`

`src/app/api/admin/highlights/route.ts` ganha um parâmetro opcional
`page`:

- **Sem `page`:** comportamento atual intacto —
  `listTodaysHighlights(marketplace)` e `{ items }`. Preserva qualquer
  outro consumidor.
- **Com `page`** (inteiro `>= 1`, valores inválidos viram `1`): usa
  `listHighlightsPage({ page, pageSize: 30, marketplaces: [marketplace],
  q: "" })` (já existe, já faz `count()` e devolve `totalPages`) e
  responde `{ items, totalPages }`. Requer `marketplace` válido; se
  ausente, mantém o `undefined` que hoje lista todos os marketplaces —
  na prática os hubs sempre mandam um.

`listHighlightsPage` não muda. `PAGE_SIZE = 30` fica como constante no
route file, com comentário de que espelha o `PAGE_SIZE` da vitrine.

### 3. Wiring de `page` na busca da Amazon

`src/app/api/admin/amazon/search/route.ts` **já** faz parse de `page` e
repassa para `searchItems(query, page, token, filters)` — nenhuma
mudança na rota. `searchItems` já usa `itemPage: page`, `itemCount: 10`.

Só o cliente `AmazonAdmin` precisa parar de fixar `page: "1"`.

A resposta da rota passa a incluir `fetchedCount: items.length` (hoje
devolve só `{ items }`), para o cliente inferir `hasNext`.

### 4. `MercadoLivreAdmin` — `src/app/admin/mercadolivre/MercadoLivreAdmin.tsx`

**Estado — remover:** `loadingMore`, `hasMore`, `liveOffset`.
**Estado — adicionar:**

```ts
const [poolPage, setPoolPage] = useState(1);
const [poolTotalPages, setPoolTotalPages] = useState(1);
const [searchPage, setSearchPage] = useState(1);
const [searchMaxPage, setSearchMaxPage] = useState(1);   // maior página vista nesta busca
const [searchHasNext, setSearchHasNext] = useState(false);
```

O modo (`pool` vs `search`) continua derivado do estado `searched`
(mesma lógica de hoje).

`PAGE_SIZE` permanece `18`.

**`loadPool(page = 1)`:** passa `&page=${page}` na URL, lê
`body.totalPages`, faz `setPoolTotalPages` e `setPoolPage(page)`.
Mantém o estilo `.then()` do código atual (não `async/await` — a regra
`react-hooks/set-state-in-effect` do lint rejeita `setState` alcançável
de dentro de uma função `async` chamada no corpo de um `useEffect`).
Sem auto-clamp quando a página volta vazia: `poolTotalPages` é
atualizado a cada carga, então o pager reflete a realidade na próxima
navegação; uma página que ficou órfã só mostra grid vazio até o
próximo clique.

**`fetchSearchPage(term, page)`:** a assinatura troca de
`(term, offset, mode)` para `(term, page)` — o parâmetro `mode` e todo
o ramo `"append"` são **removidos** (toda busca é `replace`).
Internamente `offset = (page - 1) * PAGE_SIZE`. Ao receber a resposta:

```ts
setSearchHasNext(body.fetchedCount >= PAGE_SIZE);
setSearchPage(page);
setSearchMaxPage((prev) => Math.max(prev, page));
```

- `handleSearch`, `handleClearQuery` (ramo com filtros), o `useEffect`
  de debounce e cada mudança de filtro chamam `fetchSearchPage(term, 1,
  ...)` e resetam `setSearchMaxPage(1)`.
- `handleLoadMore` é **removido**.

**Render:** o bloco `{hasMore && <button>Carregar mais</button>}` some.
No lugar, no fim do `<div className="mt-8">`:

```tsx
<HubPager
  currentPage={searched ? searchPage : poolPage}
  lastKnownPage={searched ? searchMaxPage : poolTotalPages}
  hasNext={searched ? searchHasNext : poolPage < poolTotalPages}
  exact={!searched}
  disabled={loading || searching}
  onPageChange={(page) => {
    if (searched) void fetchSearchPage(lastQuery, page);
    else void loadPool(page);
  }}
/>
```

`handleRemove` continua filtrando o estado local sem refetch (mesmo
comportamento de hoje).

### 5. `ShopeeAdmin` — `src/app/admin/shopee/ShopeeAdmin.tsx`

Mesma reestruturação do ML. Diferenças:

- Já é page-based (`page` state) — renomeado para o par
  `searchPage`/`searchMaxPage`; `hasMore` vira `searchHasNext`,
  alimentado por `body.hasNextPage` (já vem da rota).
- `PAGE_SIZE` efetivo é 20 (o `limit` do GraphQL) — não há constante no
  cliente hoje; não precisa criar, `hasNextPage` já resolve.
- Remover `loadingMore`, `handleLoadMore`, o `mode: "append"`.
- `loadPool(page)` idêntico ao do ML (com `page=`, sem clamp).

### 6. `AmazonAdmin` — `src/app/admin/amazon/AmazonAdmin.tsx`

- **Estado — adicionar:** `poolPage`, `poolTotalPages`, `searchPage`,
  `searchMaxPage`, `searchHasNext`. (Amazon não tinha nenhum estado de
  paginação.)
- `runSearch(overrideQuery?, page = 1)`: o `params.set("page", "1")`
  fixo vira `params.set("page", String(page))`. Ao receber a resposta:
  `setSearchHasNext(body.fetchedCount >= 10)`, `setSearchPage(page)`,
  `setSearchMaxPage(prev => Math.max(prev, page))`.
- `handleSearch`, `handleClearQuery` (ramo `brand`), o `useEffect` de
  debounce: chamam `runSearch(q, 1)` e resetam `searchMaxPage` para 1.
- `loadPool(page)` idêntico aos outros (com `page=`, sem clamp).
- `<HubPager>` no fim do `<div className="mt-8">`, mesmo formato do ML,
  com `onPageChange` chamando `runSearch(query, page)` ou
  `loadPool(page)`.

## Testes

- **`tests/components/HubPager.test.tsx`** (novo): usa
  `renderToStaticMarkup` de `react-dom/server` (o ambiente de teste é
  `node`, sem jsdom/testing-library) e inspeciona o HTML gerado.
  - uma página só, sem próxima → `return ""` (não renderiza nada).
  - modo exato, `currentPage=2`, `lastKnownPage=13`, `hasNext` →
    "Primeira", "‹ Anterior", "Próxima ›", "Última" presentes;
    `aria-current="page"` na página atual.
  - modo exato, `currentPage=1`: sem "Primeira"/"Anterior".
  - modo exato, última página, `hasNext=false`: sem "Próxima ›"/"Última".
  - modo janela (`exact=false`): nunca "Primeira"/"Última";
    `hasNext=true` mostra "Próxima ›", `hasNext=false` esconde.
  - `disabled=true`: todo `<button>` do HTML carrega o atributo
    `disabled`.
- **`tests/api/admin/highlights.test.ts`** (atualizar/criar):
  - `?marketplace=AMAZON&page=1` → resposta tem `totalPages` numérico.
  - `?marketplace=AMAZON` (sem `page`) → resposta inalterada, sem
    `totalPages`, `items` = todos de hoje.
  - `page` inválido (`abc`, `0`, `-1`) → tratado como `1`.
- **`tests/api/admin/amazon/search.test.ts`** (atualizar/criar):
  - `?q=fone&page=3` → `searchItems` chamado com `page = 3`.
  - resposta inclui `fetchedCount`.
- **`tests/api/admin/mercadolivre/search.test.ts`**: `?q=fone&offset=36`
  continua funcionando (a rota não muda); confirmar que
  `searchAffiliateProducts` recebe `offset = 36`.
- Verificação manual: nos três hubs, (a) pool com mais de 30 itens
  navega e volta; (b) busca com filtro navega adiante até "Próxima ›"
  sumir; (c) trocar filtro volta para página 1; (d) "Limpar filtros"
  volta ao pager exato.

## Riscos e decisões

- **Resultados instáveis entre páginas na busca ao vivo:** voltar para
  uma página já vista refaz o fetch e os itens podem ter mudado de
  ordem/preço no marketplace. Aceitável para ferramenta de admin; não
  cacheamos páginas.
- **`skip` grande no pool:** `pageSize: 30` com pool diário (algumas
  centenas de itens no máximo) — `OFFSET` do Postgres é barato nessa
  escala. Sem otimização de keyset.
- **Consumidores de `/api/admin/highlights` sem `page`:** a resposta sem
  `page` é bit-a-bit a de hoje, então nada quebra.
- **Amazon além da página ~10:** a PA-API para de retornar itens; o
  cliente vê `fetchedCount < 10`, `searchHasNext` fica `false` e
  "Próxima ›" some naturalmente. Sem tratamento especial.
