# Amazon Creators API — Design

Data: 2026-08-17

## Contexto

A Amazon liberou acesso à **Creators API** (sucessora oficial da PA-API 5, agora descontinuada — chamadas a ela retornam `403 AccessDeniedException`) para a conta do usuário. Documentação em `associados.amazon.com.br/creatorsapi/docs/en-us/`.

Hoje `collectAmazon()` (`src/lib/collect/amazon.ts`), chamado a cada 20 min pelo cron compartilhado (`/api/cron/collect`, ver `2026-08-07-vitrine-automatica-design.md`), busca produtos via `src/lib/amazon/hubClient.ts`: um endpoint interno e não documentado da página "ofertas do mês" (`amazon.com.br/d2b/api/v1/products/search`), autenticado por cookie de sessão colado manualmente pelo usuário (`/admin/amazon`, `AmazonSession`, `parseCurl.ts`). Esse mecanismo é frágil (sessão expira sem aviso, exige intervenção manual) e depende de um endpoint não suportado oficialmente — risco elevado para uma conta que já foi suspensa uma vez por questão de compliance (`2026-08-06-amazon-associates-compliance-design.md`).

Com acesso oficial liberado, este design substitui o scraper de sessão pela Creators API em todo o pipeline Amazon.

## Objetivo

`collectAmazon()` e o hub `/admin/amazon` passam a usar a Creators API oficial, no mesmo lugar do pipeline onde o scraper atua hoje — sem mudar a arquitetura geral do `vitrine-automatica-design.md` (mesmo cron de 20 min, mesmo model `Highlight`, mesmo `persistItems` compartilhado).

## Escopo

**Dentro:**
- Cliente HTTP para a Creators API (auth OAuth2 client-credentials, `SearchItems`, `GetItems`)
- Substituição completa do scraper de sessão/cookie (não fica como fallback)
- Descoberta de produtos por palavra-chave, igual ML/Shopee
- Refresh de preço dos itens Amazon já coletados, para respeitar o TTL de cache de 1h que a licença da Creators API exige para `Offers`
- Hub `/admin/amazon` convergindo para o mesmo padrão de ML/Shopee (sem tela de sessão, com campo de busca)

**Fora:**
- Mudança de frequência do cron (continua compartilhado, 20 min, junto de ML/Shopee)
- SDK oficial da Amazon (usa-se `fetch`, mesmo padrão dos outros clients do projeto)
- Refresh de ML/Shopee com garantia de TTL — só o upsert oportunista (ver seção "Atualização de preço"), aplicado aos três por reaproveitamento de `persistItems`, mas sem passada dedicada de refresh como a de Amazon

## Autenticação

OAuth2 client-credentials via Login with Amazon (LwA). O Brasil usa o endpoint regional NA (`https://api.amazon.com/auth/o2/token`).

Sem sessão persistida em banco: cada execução do cron busca um token novo (`fetchAccessToken()`) e o reutiliza durante o próprio ciclo (descoberta + refresh). Token dura 1h; como o cron roda a cada 20 min, buscar um novo por ciclo é simples e ainda está dentro do espírito das boas práticas da doc (não é "por requisição individual", é "por ciclo"). Sem tabela nova, sem lógica de expiração para monitorar.

```
POST https://api.amazon.com/auth/o2/token
{ "grant_type": "client_credentials", "client_id": ..., "client_secret": ..., "scope": "creatorsapi::default" }
→ { "access_token": "...", "expires_in": 3600 }
```

## Descoberta de produtos

Mesmo padrão de `collectMercadoLivre`/`collectShopee`: sorteia um termo de `src/lib/collect/searchTerms.ts` (`pickRandomSearchTerm()`) e chama `SearchItems`.

Como a Creators API só devolve até 10 itens por chamada, pagina `itemPage` de 1 a 5 (`itemCount: 10`) para completar o mesmo `TARGET_ITEM_COUNT = 50` já usado pelos outros marketplaces.

Sem `minSavingPercent` — o filtro de desconto mínimo não existe mais no pipeline (`2026-08-07-vitrine-automatica-design.md` já removeu essa regra dos três marketplaces), então não faz sentido reintroduzi-la só para Amazon.

Parâmetros fixos por request: `marketplace: "www.amazon.com.br"`, `partnerTag: process.env.AMAZON_AFFILIATE_TAG`, `resources: ["images.primary.medium", "itemInfo.title", "offersV2.listings.price"]`.

## Mapeamento de resposta

`detailPageURL` da resposta já vem com a tag de afiliado aplicada (`?tag=...&linkCode=ogi`) — diferente do hub atual, que monta o link manualmente (`buildAffiliateLink`). Usa-se `detailPageURL` direto como `affiliateLink`, sem construção local.

Desconto vem numérico em `item.offersV2.listings[0].price.savings.percentage` — não precisa mais do parser de regex `parseDiscountPercentage` (`src/lib/mercadolivre/discountLabel.ts`) para Amazon; esse parser continua em uso só para ML, cuja busca só devolve label de texto.

```ts
type SearchItemsProduct = {
  asin: string;
  detailPageURL: string;
  itemInfo?: { title?: { displayValue?: string } };
  images?: { primary?: { medium?: { url?: string } } };
  offersV2?: {
    listings?: Array<{
      price?: {
        money?: { amount?: number };
        savingBasis?: { money?: { amount?: number } };
        savings?: { percentage?: number };
      };
    }>;
  };
};
```

## Atualização de preço (compliance de TTL)

A licença da Creators API define TTL máximo de cache: 1h para `Offers` (preço/desconto), 1 dia para o resto. Sem um mecanismo de refresh, um item coletado às 5h20 ficaria com o mesmo preço exibido até o corte das 5h do dia seguinte — quase 24h, acima do permitido.

**`persistItems` passa a fazer upsert** por `(marketplace, productId)` em vez de `createMany` com `skipDuplicates`: se o item já existe, atualiza `price`/`oldPrice`/`discount`/`updatedAt`; se não existe, cria. Aplicado aos três marketplaces (mesma função compartilhada) — não há razão para deixar ML/Shopee propositalmente desatualizados.

Esse upsert sozinho só cobre redescoberta incidental (quando o mesmo termo de busca é sorteado de novo, o que estatisticamente leva várias horas com ~20 termos). Para cumprir o TTL de 1h de verdade, Amazon ganha uma **passada de refresh dedicada e gatilhada por idade**:

- `refreshAmazonPrices()`, chamada a cada ciclo do cron (junto de `collectAmazon`), busca os `Highlight` de `marketplace = AMAZON` do pool de hoje com `updatedAt` há mais de 50 min.
- Agrupa os `productId` (ASINs) em lotes de até 10 e chama `GetItems` para cada lote (`resources: ["itemInfo.title", "offersV2.listings.price"]` — só precisa dos campos de oferta, não precisa reconsultar imagem/título que não mudam).
- Atualiza `price`/`oldPrice`/`discount`/`updatedAt` de cada item retornado. Item que não vier mais na resposta do `GetItems` (removido do catálogo) não é apagado — fica com o dado antigo até o corte das 5h, mesma política de erro silencioso já usada no resto do pipeline.

Custo: como um item só "vence" a cada 1h independente da frequência do cron, o volume de chamadas de refresh escala com o **tamanho do pool**, não com os 72 ciclos/dia. Ver seção "Rate limits" para os números.

Chamadas sequenciais (auth → descoberta → refresh) devem ter um pequeno espaçamento (~1.1s) entre requisições à Creators API para respeitar o TPS inicial de 1/segundo, já que a latência de rede sozinha não garante ficar abaixo desse teto.

## Rate limits

Confirmado na doc (`concepts/api-rates`): conta nova começa com **1 TPS e 8640 TPD** (transações por dia) nos primeiros 30 dias; a cota cresce com a receita gerada via Creators API (nunca diminui abaixo do inicial). `429 TooManyRequests` sinaliza estouro.

Estimativa de uso diário:
- Descoberta: 5 chamadas `SearchItems` × 72 ciclos/dia = **360/dia** (fixo, não cresce com o pool)
- Refresh: como o pool converge rápido para um teto (~20 termos × até 50 itens novos na primeira vez que cada termo é sorteado ≈ até ~1000 itens únicos/dia, provavelmente menos por sobreposição entre termos parecidos), e o refresh só roda por item vencido (a cada ~1h), a média fica em torno de **~1200 chamadas/dia** (pool médio de ~500 itens ao longo do dia × 24 refreshes/dia ÷ 10 ASINs por chamada)
- Total: **~1500-1600/dia**, ~18% da cota de 8640 TPD

Sem risco de acúmulo entre dias: o pool é apagado todo dia às 5h (`deleteStaleHighlights`), então o teto se repete diariamente, não soma.

`429` tratado como erro não-fatal do ciclo (`CollectResult.error = "rate_limited"`), sem derrubar os outros marketplaces — mesmo padrão de `Promise.allSettled` já usado em `/api/cron/collect`.

## Hub admin `/admin/amazon`

Converge para o mesmo padrão de `/admin/mercadolivre` e `/admin/shopee`:
- Sem tela de "colar sessão" — a página carrega automaticamente os itens do pool Amazon de hoje ao abrir (mesmo filtro de corte de 5h dos outros hubs).
- Ganha um campo de busca por palavra-chave (hoje não existe, porque o feed de ofertas não precisava de um). Busca manual chama `SearchItems` e grava no mesmo pool via `persistItems` — mesmo comportamento do ML/Shopee.
- "Selecionar para postar" inalterado (`PostDraft`, fora do escopo deste design).

## Modelo de dados

`Highlight` ganha `updatedAt`, necessário para o gatilho de refresh por idade e para auditar frescor de dados:

```prisma
model Highlight {
  id            String      @id @default(cuid())
  marketplace   Marketplace
  productId     String
  title         String
  affiliateLink String
  image         String
  price         Float
  oldPrice      Float?
  discount      Float?
  note          String
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([marketplace, productId])
  @@index([createdAt])
}
```

`AmazonSession` é removida do schema.

## Componentes / arquivos

Novo:
- `src/lib/amazon/creatorsApiClient.ts` — `fetchAccessToken()`, `searchItems(term, page, token)`, `getItems(asins, token)`; parsing de `SearchItemsProduct`/`GetItemsProduct` para `AmazonDealItem` (mesmo shape usado hoje, reaproveitado).
- `src/lib/collect/amazon.ts` — `collectAmazon()` reescrito para usar `searchItems` em vez de `listDeals`; ganha `refreshAmazonPrices()` (busca `Highlight` de `AMAZON` com `updatedAt` velho, chama `getItems` em lotes de 10, atualiza).
- `src/app/api/admin/amazon/search/route.ts` — substitui `deals/route.ts`; `GET ?q=` chama `searchItems` + `persistItems`, mesmo padrão de `/api/admin/mercadolivre/search`.

Alterado:
- `src/lib/collect/persist.ts` — `persistItems` passa de `createMany({skipDuplicates: true})` para upsert por item (loop com `prisma.highlight.upsert`).
- `src/app/api/cron/collect/route.ts` — `collectAmazon()` chama internamente a descoberta + o refresh; assinatura de `POST` não muda.
- `src/app/admin/amazon/AmazonAdmin.tsx` — perde a tela/estado de sessão, ganha campo de busca, carrega pool automaticamente ao montar (mesmo padrão de `MercadoLivreAdmin.tsx`).

Removido:
- `src/lib/amazon/session.ts`, `src/lib/amazon/parseCurl.ts`, `src/lib/amazon/hubClient.ts` (versão cookie), `src/app/api/admin/amazon/session/route.ts`, `src/app/api/admin/amazon/deals/route.ts`.
- Model `AmazonSession` do schema, e a migração correspondente de remoção.

## Novas env vars

- `AMAZON_CREATORS_CLIENT_ID`
- `AMAZON_CREATORS_CLIENT_SECRET`
- `AMAZON_CREATORS_CREDENTIAL_VERSION` (ex.: `3.1`, versão NA)

`AMAZON_AFFILIATE_TAG` é reaproveitada como `partnerTag` nas requisições — sem mudança de nome ou valor.

## Tratamento de erros

- Falha de autenticação (token inválido/expirado no meio do ciclo) e `429` mapeiam para `CollectResult.error`, sem lançar exceção — mesmo padrão de `AmazonSessionExpiredError`/`MercadoLivreSessionExpiredError` hoje, só que sem exigir intervenção manual do usuário (credenciais de app não "expiram" como cookie de sessão).
- `refreshAmazonPrices()` com falha isolada em um lote de `GetItems` não interrompe os outros lotes nem a descoberta do ciclo — cada lote é tentado independentemente, falha loga e segue.

## Testes

- `creatorsApiClient.ts`: `fetchAccessToken` (mock do endpoint LwA), `searchItems`/`getItems` parseando fixtures de resposta (incluindo o exemplo real capturado da doc) para `AmazonDealItem[]`.
- `persistItems`: novo caso — item já existente é atualizado (`price`/`oldPrice`/`discount`/`updatedAt`), não duplicado; item novo continua sendo inserido normalmente. Cobre os três marketplaces.
- `collectAmazon`: paginação até 50 itens via `searchItems`; propagação de erro de auth/429 como `CollectResult.error`.
- `refreshAmazonPrices`: só seleciona itens com `updatedAt` mais velho que o limiar; agrupa em lotes de até 10; atualiza campos de oferta sem tocar em `title`/`image`/`affiliateLink`.
- `/api/admin/amazon/search`: mesmo padrão de teste já existente para `/api/admin/mercadolivre/search`.

## Verificação manual

1. Rodar a migração (remove `AmazonSession`, adiciona `Highlight.updatedAt`) contra Neon.
2. Configurar `AMAZON_CREATORS_CLIENT_ID`/`SECRET`/`CREDENTIAL_VERSION` na Vercel.
3. Disparar `POST /api/cron/collect` manualmente e confirmar que `Highlight` recebe itens Amazon via Creators API (checar no log/response que não há mais menção a sessão/cookie).
4. Abrir `/admin/amazon` e confirmar que carrega o pool automaticamente, sem tela de sessão; testar o campo de busca por palavra-chave.
5. Rodar `POST /api/cron/collect` duas vezes seguidas e confirmar que um item Amazon já existente teve `updatedAt` atualizado (upsert funcionando).
6. Aguardar (ou forçar via update direto no banco) um item Amazon com `updatedAt` > 50 min e confirmar que o próximo ciclo do cron atualiza `price`/`oldPrice`/`discount` via `refreshAmazonPrices`.
7. Abrir um link de afiliado gerado e confirmar que a tag (`tag=bonsachados0f-20`) aparece na URL.
