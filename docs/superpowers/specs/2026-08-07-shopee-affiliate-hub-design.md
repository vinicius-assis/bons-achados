# Shopee Affiliate Open API Hub — Design

Data: 2026-08-07

## Contexto

Hoje, produtos Shopee só entram no app pelo formulário manual (`/admin/produtos/novo`, `NovoProdutoForm.tsx`): link de afiliado em texto livre, sem validação client ou server (risco aceito documentado em `docs/superpowers/specs/2026-08-06-amazon-associates-compliance-design.md`). A Shopee expõe uma API oficial de afiliados (Shopee Affiliate Open API, GraphQL, autenticação assinada por AppId/Secret) que devolve produtos com link de afiliado (`offerLink`) já pronto — o mesmo tipo de fonte que os hubs de Amazon e Mercado Livre já usam para eliminar cadastro manual sem tag.

Documentação consultada em `https://affiliate.shopee.com.br/open_api/document` e `https://affiliate.shopee.com.br/open_api/list`:

- **Overview**: endpoint único `https://open-api.affiliate.shopee.com.br/graphql`, protocolo GraphQL via `POST`, rate limit 8000 req/hora.
- **Authentication**: header `Authorization: SHA256 Credential={AppId}, Timestamp={Timestamp}, Signature={SHA256(AppId+Timestamp+Payload+Secret)}`. Sem sessão/cookie — credenciais estáticas (AppId + Secret) obtidas no portal de afiliados.
- **Request and Response**: corpo `{"query": "...", "variables": {...}}`, resposta `{"data": {...}, "errors": [...]}`. Lista de error codes (10000 system error, 10010 parsing, 10020 auth, 10030 rate limit, 11000 business error).
- **Get Product Offer List** (`productOfferV2`): busca por `keyword`, com `sortType`, `page`, `limit`. Resposta traz `itemId`, `productName`, `priceMin`/`priceMax`, `priceDiscountRate`, `imageUrl`, `productLink`, `offerLink` (já é o link de afiliado rastreável), `shopName`, `commissionRate`, `ratingStar`, `sales`, e `pageInfo.hasNextPage`.
- **Get Short Link** (`generateShortLink`): converte uma URL arbitrária de produto Shopee em link de afiliado curto. Não usado nesta v1 — `offerLink` da busca já resolve o caso de uso.

O usuário já possui AppId e Secret da plataforma.

## Objetivo

Substituir o cadastro manual de produtos Shopee por um hub com busca por palavra-chave, no mesmo padrão dos hubs de Amazon e Mercado Livre já existentes (`src/app/admin/amazon`, `src/app/admin/mercadolivre`).

## Decisões (confirmadas com o usuário)

1. O hub **substitui** o cadastro manual — não convive com ele.
2. Descoberta de produtos é só por **busca por palavra-chave** (como o Mercado Livre), sem feed automático de "top performing".
3. Como Amazon e Shopee migram para hub-only, a página `/admin/produtos/novo` (`NovoProdutoForm.tsx`) fica sem nenhum marketplace válido para usar — **é removida por completo**, junto com sua entrada no `AdminNav.tsx`.

## Escopo

**Dentro:**
- Cliente HTTP assinado para a Shopee Affiliate Open API (`src/lib/shopee/client.ts`).
- Busca de produtos por palavra-chave (`src/lib/shopee/hubClient.ts`, query `productOfferV2`).
- Rota `GET /api/admin/shopee/search`.
- UI `src/app/admin/shopee/ShopeeAdmin.tsx` + `page.tsx`, sem tela de sessão (a API não usa cookies).
- Atualização do `AdminNav.tsx`: troca "Cadastrar produto" por "Hub Shopee".
- Remoção de `src/app/admin/produtos/novo/` (`page.tsx`, `NovoProdutoForm.tsx`).
- Env vars `SHOPEE_APP_ID`, `SHOPEE_APP_SECRET` (documentadas em `.env.example`).

**Fora:**
- `generateShortLink` (mutation de link curto) — `offerLink` da busca já é um link de afiliado pronto; não há caso de uso para converter URL arbitrária nesta v1.
- Qualquer feed automático (`listItemFeeds`/`Get Product Feed Offer List`) — é uma API de catálogo em massa (retorna referências de arquivo, não produtos individuais), não serve para o fluxo "admin busca e destaca um produto".
- `Get Shopee Offer List` / `Get Brand Offer List` (ofertas de campanha/marca, não produtos individuais) e `Get Conversion Report` / `Get Validated Report` (relatórios de comissão) — fora do escopo de descoberta de produto.
- Throttling client-side do rate limit (8000/h) — folgado demais para uso manual de admin; YAGNI.
- Testes de UI automatizados — o projeto não tem suíte de UI para os admins hoje; verificação manual faz parte do plano de implementação.

## Mudanças

### 1. Cliente assinado (`src/lib/shopee/client.ts`)

```ts
export class ShopeeApiError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = "ShopeeApiError";
  }
}

export async function shopeeRequest<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T>
```

Responsabilidades:
- Lê `SHOPEE_APP_ID` e `SHOPEE_APP_SECRET` do ambiente; lança erro imediato (sem chamar `fetch`) se qualquer um estiver ausente — mesmo padrão do `AMAZON_AFFILIATE_TAG` em `src/lib/amazon/hubClient.ts:112-115`.
- Monta o payload: `JSON.stringify({ query, variables })` (payload é exatamente o corpo enviado, igual ao exemplo da doc).
- Timestamp: `Math.floor(Date.now() / 1000)`.
- Assinatura: `createHash("sha256").update(AppId + Timestamp + Payload + Secret).digest("hex")` (`crypto` do Node, mesmo módulo usado em `src/lib/adminAuth.ts`).
- Header: `Authorization: SHA256 Credential=${AppId}, Timestamp=${Timestamp}, Signature=${signature}`.
- `POST` para `https://open-api.affiliate.shopee.com.br/graphql`, `content-type: application/json`, `signal: AbortSignal.timeout(10_000)` (mesmo timeout dos outros hubs).
- Se a resposta não for `ok`, lança `ShopeeApiError` com o status.
- Se o corpo tiver `errors` não-vazio, lança `ShopeeApiError` com a primeira mensagem e `extensions.code` do primeiro erro.
- Caso contrário, retorna `body.data as T`.

### 2. Busca de produtos (`src/lib/shopee/hubClient.ts`)

```ts
export type ShopeeHubItem = {
  itemId: string;
  title: string;
  price: number;
  discount: number | null;
  image: string;
  affiliateLink: string;
  productLink: string;
  shopName: string;
  commissionRate: string | null;
  ratingStar: number | null;
};

export async function searchProducts(
  keyword: string,
  page: number
): Promise<{ items: ShopeeHubItem[]; hasNextPage: boolean }>
```

- Query GraphQL: `productOfferV2(keyword: $keyword, sortType: 1, page: $page, limit: 20) { nodes { itemId commissionRate priceMin priceDiscountRate imageUrl offerLink productLink productName shopName ratingStar } pageInfo { hasNextPage } }` — `sortType: 1` é `RELEVANCE_DESC`, único sort que faz sentido para busca por palavra-chave.
- `limit: 20`, mesmo tamanho de página do Mercado Livre (`PAGE_SIZE = 18` lá, arredondo pra 20 aqui — não é um valor crítico).
- Mapeamento por nó, com `try/catch` individual (mesmo padrão de `parseProduct`/`parseCard`): item malformado é descartado, não derruba a lista inteira.
  - `price = Number(node.priceMin)` — se `NaN`, descarta o item (preço é obrigatório para o `Highlight`).
  - `discount = node.priceDiscountRate` (já é número, ex.: `10` para 10%; `null` se ausente ou zero).
  - `affiliateLink = node.offerLink`.
  - `itemId = String(node.itemId)`.
- Se `keyword` for string vazia, retorna `{ items: [], hasNextPage: false }` sem chamar a API (evita busca "tudo" acidental — mesmo espírito do ML, que exige o usuário digitar algo).

### 3. Rota `GET /api/admin/shopee/search`

`src/app/api/admin/shopee/search/route.ts`, no padrão de `src/app/api/admin/mercadolivre/search/route.ts`:

```ts
export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const keyword = request.nextUrl.searchParams.get("q") ?? "";
  const rawPage = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  try {
    const { items, hasNextPage } = await searchProducts(keyword, page);
    return NextResponse.json({ items, hasNextPage });
  } catch (error) {
    console.error("Shopee hub search failed:", error);
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }
}
```

Sem verificação de sessão (não existe) — só a autenticação de admin do próprio app.

### 4. UI (`src/app/admin/shopee/ShopeeAdmin.tsx` + `page.tsx`)

Modelada em `MercadoLivreAdmin.tsx`, removendo todo o bloco de "conectar sessão" (`hasSession`, `showSessionForm`, `curlCommand`, `handleSaveSession`, painel de instruções cURL). Mantém:

- Campo de busca (`query`, `useState`) + botão "Buscar".
- Estado de paginação por `page` (inicia em 1, incrementa em "Carregar mais" enquanto `hasNextPage` for `true`) — troca o padrão de offset numérico da Amazon/ML pelo padrão `page`/`hasNextPage` que a Shopee usa nativamente.
- Grid de cards: imagem, nome do produto, preço (`formatPrice`), badge de desconto se `discount` não for `null` (reaproveita o estilo do badge de desconto da Amazon), nome da loja + rating, chip de comissão (reaproveita o componente visual `CommissionTag` do `MercadoLivreAdmin.tsx`, adaptado para `commissionRate`).
- Campo de link somente-leitura + "Copiar" (padrão do `AmazonAdmin.tsx`, já que `affiliateLink` vem pronto — sem passo de "gerar link" como no ML).
- "Selecionar para postar" → `POST /api/admin/postdraft` com `marketplace: "SHOPEE"`, `source: "AUTO"`.
- Dropdown de templates de nota + textarea + "Destacar na vitrine" → `POST /api/admin/highlights` com `marketplace: "SHOPEE"`, `oldPrice: null` (Shopee não fornece preço original).

`page.tsx`: mesmo formato do `mercadolivre/page.tsx`, com `metadata` própria.

### 5. Navegação e remoção do formulário manual

`src/app/admin/AdminNav.tsx`: troca a entrada `{ href: "/admin/produtos/novo", label: "Cadastrar produto" }` por `{ href: "/admin/shopee", label: "Hub Shopee" }`, na mesma posição relativa aos outros hubs.

Remove:
- `src/app/admin/produtos/novo/page.tsx`
- `src/app/admin/produtos/novo/NovoProdutoForm.tsx`

Nenhuma outra rota referencia esses arquivos (confirmado por busca no código) — as rotas `/api/admin/postdraft` e `/api/admin/highlights` continuam aceitando `marketplace: "SHOPEE"` normalmente, só o caminho de entrada manual deixa de existir.

### 6. Variáveis de ambiente

`.env.example` ganha:
```
SHOPEE_APP_ID="your-shopee-app-id"
SHOPEE_APP_SECRET="your-shopee-app-secret"
```

## Validação e limites

- `keyword` vazio: busca não é disparada (nem client nem server-side), evita resultado "tudo" sem sentido.
- `page`: mínimo 1, qualquer valor inválido cai para 1 (mesmo padrão de `offset` na rota da Amazon).
- Preço ausente/inválido (`priceMin` não numérico): item descartado da lista, não derruba a busca inteira.

## Testes

- `tests/shopee/client.test.ts`:
  - Caso "padrão-ouro" da documentação: `AppId=123456`, `Secret=demo`, `Timestamp=1577836800`, payload fixo → assinatura exata `43a5dabcfb6598dfcaefc377088988228ddc512202fee19d2ceca1909cba60c6` (mockando `Date.now` para o timestamp bater). Esse valor foi verificado de forma independente com `sha256sum`; o valor impresso na página da Shopee (`dc88d72f...`) está desatualizado/incorreto — o algoritmo em si (prosa da doc) não está em dúvida.
  - Lança erro antes de chamar `fetch` quando `SHOPEE_APP_ID`/`SHOPEE_APP_SECRET` ausentes.
  - Lança `ShopeeApiError` quando a resposta tem `errors[]` preenchido.
  - Lança `ShopeeApiError` em status não-200.
  - Retorna `data` corretamente em resposta válida.
- `tests/shopee/hubClient.test.ts`:
  - Mapeia uma fixture realista de `productOfferV2` para `ShopeeHubItem[]`.
  - `hasNextPage` repassado de `pageInfo`.
  - Item malformado (sem `priceMin` válido) é descartado sem derrubar os demais.
  - `keyword` vazio retorna `{ items: [], hasNextPage: false }` sem chamar `shopeeRequest`.
- `tests/api/admin/shopee/search.test.ts`:
  - 401 sem cookie de admin, sem chamar `searchProducts`.
  - Repassa `q` e `page` da query string para `searchProducts`.
  - `page` ausente/inválido cai para 1.
  - 502 quando `searchProducts` rejeita.

## Verificação manual

1. Configurar `SHOPEE_APP_ID`/`SHOPEE_APP_SECRET` no `.env`.
2. Abrir `/admin/shopee`, buscar um termo real, confirmar que os resultados vêm com preço, imagem e link de afiliado.
3. Selecionar um item para postar e confirmar que aparece na fila do Postar.
4. Destacar um item com nota e confirmar que aparece na vitrine pública com o link de afiliado correto.
5. Confirmar que `/admin/produtos/novo` não existe mais (404) e que o link "Hub Shopee" aparece no menu admin.
