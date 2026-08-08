# Vitrine automática — Design

Data: 2026-08-07

## Objetivo

Substituir a curadoria manual da vitrine pública (botão "Destacar na vitrine" nos hubs) por um pool de itens coletado automaticamente dos três marketplaces (Mercado Livre, Amazon, Shopee), com paginação de 30 em 30 na vitrine pública e reabastecimento automático. Os hubs admin (`/admin/mercadolivre`, `/admin/amazon`, `/admin/shopee`) passam a servir só pra selecionar itens pra postar (`PostDraft` / Telegram-Instagram), mas leem/escrevem no mesmo pool compartilhado.

## Contexto

Investigação do código atual (2026-08-07) mostrou que o pipeline automático de Mercado Livre descrito no spec original (`2026-08-01-bons-achados-design.md`) — cron de coleta, model `Product`, Telegram — nunca foi implementado. O que existe hoje:

- Três hubs admin (ML, Amazon, Shopee), cada um com busca on-demand (ML e Shopee por palavra-chave; Amazon por feed de ofertas do dia, sem keyword) e sessão/API key própria.
- `PostDraft`: fila de itens selecionados pra postar (fluxo de Telegram/Instagram), inalterada por este design.
- `Highlight`: tabela da vitrine pública, hoje só populada por curadoria manual (botão "Destacar" em cada hub), com `note` obrigatória (mín. 15 caracteres) por exigência da Amazon (motivo de uma suspensão anterior da conta por falta de conteúdo original).
- Model `Product`: existe no schema, mas não tem nenhuma referência no código — morto.

Como não há cron nem pipeline automático hoje, esta mudança é greenfield para os três marketplaces (não é uma migração de um cron existente).

## Decisões (confirmadas com o usuário)

1. **Nota de conteúdo original**: em vez de IA gerar uma nota por item (custo é desprezível — estimado em frações de centavo de dólar por item, não foi o motivo da escolha), usa-se um **pool fixo de ~50 notas genéricas**, sorteadas/rotacionadas por item. Risco assumido: texto repetitivo entre produtos diferentes pode voltar a acionar o motivo da suspensão anterior da Amazon (falta de conteúdo original por oferta) — decisão de simplicidade para o MVP, revisitar se a Amazon reprovar por esse motivo de novo.
2. **Vitrine 100% automática**: sem curadoria manual. Os botões "Destacar na vitrine" saem dos três hubs; a rota `POST /api/admin/highlights` é removida.
3. **Pool compartilhado entre vitrine e hub**: o mesmo dado que a coleta automática grava é o que os hubs mostram ao abrir (sem precisar buscar) e o que a vitrine pública pagina. Uma busca manual no hub grava no mesmo pool (mesmo filtro/dedup/nota do cron).
4. **Mercado Livre entra no escopo** (não fica de fora): os três marketplaces usam a mesma lógica de coleta automática.
5. **Gatilho de coleta: cron periódico**, não sob demanda — a vitrine pública só lê do banco, nunca chama API externa na hora do acesso de um visitante (evita latência/timeout na função serverless).
6. **Filtro de qualidade mínimo**: só descarta item com dado inválido (sem imagem, sem preço positivo — mesma regra já aplicada ao Shopee no commit `b6a6f37`). Sem exigir desconto/nota mínima, que nem sempre vêm preenchidos pelas APIs de Amazon/Shopee.
7. **Lista de termos de busca para ML/Shopee**: lista fixa proposta abaixo, editável no código depois.
8. **Corte diário às 5h** (não 8h, ajustado durante a revisão): limpeza roda às 5h da manhã (America/Sao_Paulo) e, no mesmo workflow, dispara a coleta em seguida — minimiza a janela em que a vitrine fica vazia entre limpar e repopular.
9. **Alertas de sessão expirada**: e-mail de falha do GitHub Actions (canal já existente, nenhum canal de notificação dedicado foi construído) — suficiente pro MVP.

## Arquitetura / Fluxo de dados

```
[A cada 20 min, GitHub Actions]
  cron → POST /api/cron/collect (secret)
      → para cada marketplace, independente (falha em um não trava os outros):
          Amazon: pagina feed de ofertas do dia (sem keyword), até 50 itens
          ML / Shopee: sorteia 1 termo da lista fixa, busca até 50 itens
      → cada item: filtro (imagem + preço válido) → dedup (marketplace, productId)
        contra Highlight → sorteia 1 nota do pool de 50 → grava em Highlight

[Às 5h da manhã, America/Sao_Paulo, mesmo workflow]
  cron → POST /api/cron/highlights-cleanup (secret)
      → apaga todo Highlight com createdAt anterior a hoje 5h
      → (mesmo job, step seguinte) dispara POST /api/cron/collect imediatamente
        (não espera o próximo tick do cron periódico de 20 min)

[Visitante do site]
  GET / ou /?page=N → lê Highlight (createdAt >= corte de hoje 5h),
      30 por página, createdAt desc — nunca chama API externa

[Admin, a qualquer momento]
  GET /admin/{mercadolivre,amazon,shopee}
      → carrega automaticamente os itens já no pool daquele marketplace
        (mesmo filtro do corte de hoje)
      → busca manual (ML/Shopee: keyword; Amazon: sem campo, já é feed)
        grava no mesmo pool (mesmo filtro/dedup/nota)
      → "Selecionar para postar" grava em PostDraft, inalterado
```

## Modelo de dados

`Highlight` ganha `productId` (chave de dedup) e perde a obrigatoriedade de nota "escrita à mão" (passa a vir do pool):

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

  @@unique([marketplace, productId])
  @@index([createdAt])
}
```

Migração: linhas antigas de `Highlight` (curadoria manual anterior) não têm `productId` — são apagadas antes da migração (mesmo espírito do "one-off cleanup" já feito pra Amazon no spec de compliance), já que de qualquer forma somem no próximo corte das 5h.

Model `Product` é removido do schema (zero referências no código).

## Pool de notas genéricas

`src/lib/highlights/noteTemplates.ts` já existe (10 notas genéricas, hoje usadas como sugestões no dropdown do textarea manual que está sendo removido) — é expandido para ~50 entradas e ganha uma função `pickRandomNote(): string` (sorteio simples via `Math.random()` sobre o array, não precisa ser determinístico). Reaproveita o arquivo existente em vez de criar um novo; o conteúdo das notas continua sem menção a produto específico (mesmo espírito das 10 atuais).

## Lista de termos de busca (ML / Shopee)

Lista fixa em `src/lib/collect/searchTerms.ts`, ~15-20 categorias genéricas de e-commerce brasileiro: eletrônicos, celular, informática, casa, cozinha, beleza, moda, calçados, esporte, brinquedos, livros, bebê, pet, ferramentas, automotivo, games, som e áudio, decoração, papelaria, saúde. A cada ciclo do cron, cada marketplace que precisa de keyword sorteia 1 termo dessa lista.

## Pipeline de coleta (`src/lib/collect/`)

- `collectAmazon(): Promise<CollectResult>` — pagina `listDeals` (já existe em `src/lib/amazon/hubClient.ts`) até acumular 50 itens ou esgotar páginas; `discount` via `parseDiscountPercentage(item.discountLabel)` (já existe em `src/lib/mercadolivre/discountLabel.ts`, reaproveitado — já é o padrão hoje).
- `collectMercadoLivre(): Promise<CollectResult>` — sorteia termo, chama `searchAffiliateProducts` do hub ML existente; para cada item que ainda não existe em `Highlight` (checado antes de gastar uma chamada de rede), chama `createAffiliateLink` (já existe em `src/lib/mercadolivre/createLink.ts`) pra obter o link antes de persistir — ver seção "Particularidade do Mercado Livre" abaixo; `discount` via `parseDiscountPercentage(item.discountLabel)`.
- `collectShopee(): Promise<CollectResult>` — sorteia termo, chama `searchProducts` do hub Shopee existente; `discount` já vem numérico (`item.discount`), sem parsing; `oldPrice` sempre `null` (mesmo padrão manual atual).
- `persistItems(marketplace, items): Promise<{inserted: number; skipped: number}>` — função compartilhada pelos três: filtra (imagem + preço > 0, mesmo padrão já usado em `parseNode` do hub Shopee), dedup via `@@unique([marketplace, productId])` (upsert com `skipDuplicates` ou `createMany` ignorando conflito — decidir na implementação qual API do Prisma cabe melhor), atribui `pickRandomNote()`, grava.
- `CollectResult = { attempted: number; inserted: number; skipped: number; error?: string }` por marketplace — usado tanto pelo cron quanto pelo carregamento automático do hub.

`POST /api/cron/collect` (protegida por secret, mesmo padrão de `POSTDRAFT_CLEANUP_SECRET`): chama os três coletores em `Promise.allSettled` (um rejeitar não derruba os outros), loga cada resultado, retorna 200 com o resumo — mas se algum marketplace falhar (ex.: sessão expirada), essa falha é logada e o step do workflow correspondente é o que fica visível como erro no GitHub Actions (mecanismo exato de "falhar visivelmente por marketplace" decidido na implementação, ex.: resposta HTTP 207 com detalhe por marketplace, e o workflow YAML inspeciona o corpo).

## Vitrine pública

`src/app/page.tsx` (Server Component) passa a paginar: `?page=N` (default 1), 30 itens por página, `createdAt >= corte de hoje 5h`, `createdAt desc`.

`startOfTodayInBrazil()` (`src/lib/date.ts`) muda de meia-noite para 5h: se a hora atual em America/Sao_Paulo for antes das 5h, o "corte de hoje" é 5h de ontem; senão, 5h de hoje.

### Filtro por marketplace e busca por texto

Um `<form method="get">` no topo da página, sem JavaScript de estado no cliente — a própria navegação GET recarrega `/` com os novos query params, mantendo a página um Server Component simples:

- Três checkboxes ("Mercado Livre", "Amazon", "Shopee"), `name="marketplace"` cada um com o valor do enum (`MERCADO_LIVRE`/`AMAZON`/`SHOPEE`). Marcar um ou mais mostra só esses; marcar nenhum (comportamento padrão, form nunca submetido) mostra todos.
- Um campo de texto `name="q"` — busca por substring no título, case-insensitive (Prisma `contains` + `mode: "insensitive"`). Sem índice de full-text novo: o volume esperado (pool renovado a cada 5h, algumas centenas de itens) não justifica um índice GIN/trigram — revisitar só se o volume crescer muito.
- Um campo oculto `name="filtered" value="1"`, sempre enviado junto do form — resolve a ambiguidade de checkboxes desmarcados: HTML não envia checkboxes desmarcados no GET, então "nenhum marketplace marcado" e "usuário nunca tocou no filtro" teriam a mesma URL (sem `marketplace=`) se não fosse por esse marcador. Regra: sem `filtered=1` → mostra todos os marketplaces (estado inicial); com `filtered=1` e nenhum `marketplace=` → mostra lista vazia (usuário desmarcou tudo de propósito).
- `page` não é um campo do form (não carrega valor anterior) — qualquer submissão do filtro/busca naturalmente volta pra página 1. Os links de "próxima página"/"página anterior" preservam `marketplace`, `q` e `filtered` na querystring.
- Query final: `marketplace IN (...)` (ou todos, conforme regra acima) `AND title ILIKE '%q%'` (se `q` não vazio) `AND createdAt >= corte de hoje 5h`, ordenado por `createdAt desc`, paginado.

## Hub admin

Cada `AdminXAdmin.tsx` (ML/Amazon/Shopee):
- Remove o botão "Destacar na vitrine" e o textarea de nota associado (do spec de compliance) — a nota agora vem do pool automático, não é mais escrita por item no hub.
- Ao montar a página, chama a mesma função `collectX`/lista do pool (sem custo de rede novo pro admin — lê do banco, filtrado por marketplace + corte de hoje) em vez de começar vazio.
- Busca manual (campo de keyword pra ML/Shopee) continua existindo, mas agora os resultados passam por `persistItems` antes de renderizar — ou seja, aparecem tanto na tela do hub quanto (na próxima carga) na vitrine pública.
- "Selecionar para postar" inalterado.
- Cada card do pool ganha um botão "Remover da vitrine" — chama `DELETE /api/admin/highlights/[id]`. Sem essa válvula de escape, um item ruim que passe pelo filtro mínimo ("só dados válidos") ficaria no ar até o corte das 5h do dia seguinte, sem nenhuma curadoria manual pra tirá-lo antes.

## Particularidade do Mercado Livre: link gerado, não estático

Diferente de Amazon (link determinístico: ASIN + tag) e Shopee (a busca já devolve `offerLink` pronto), o hub ML hoje não tem link de afiliado no resultado da busca — é preciso um passo manual separado ("Gerar link", que chama a API `createLink` da ML por item) antes de poder destacar ou postar um item.

Como a coleta automática precisa gravar `Highlight.affiliateLink` sem intervenção humana, `collectMercadoLivre` chama `createLink` internamente para cada item novo (que ainda não existe em `Highlight`, ou seja, o dedup por `productId` evita gerar de novo um link para um item já coletado no ciclo atual) — antes de persistir. Consequência: o botão "Gerar link" e sua UI no hub ML deixam de fazer sentido (o link já vem pronto assim que o item aparece na tela, igual Amazon/Shopee), e são removidos, junto do model `MercadoLivreGeneratedLink` e da rota `POST /api/admin/mercadolivre/generate-link` (o dedup que essa tabela fazia — não gerar link duas vezes no mesmo dia — passa a acontecer via `@@unique([marketplace, productId])` do próprio `Highlight`).

Risco operacional aceito: isso torna `collectMercadoLivre` mais lento e mais sujeito a falha que os outros dois marketplaces — até 50 chamadas de rede extra (uma por item novo) por ciclo, cada uma podendo falhar por sessão expirada. Mitigado pelo mesmo tratamento de erro isolado por marketplace já definido (uma falha aqui não trava Amazon/Shopee).

## Cron / limpeza (workflow único às 5h)

`.github/workflows/highlights-cleanup.yml` (schedule ajustado): `cron: "0 8 * * *"` (5h America/Sao_Paulo = 8h UTC, fixo, sem DST — mesmo padrão dos workflows existentes). Dois steps sequenciais no mesmo job:
1. `curl` pra `POST /api/cron/highlights-cleanup` (apaga `Highlight` com `createdAt` antes do corte de hoje 5h).
2. `curl` pra `POST /api/cron/collect`, imediatamente depois — repopula antes que a janela vazia dure mais que o tempo desses dois requests.

`.github/workflows/collect.yml` (novo): `cron: "*/20 * * * *"`, chama só `POST /api/cron/collect`, roda o dia inteiro independente do workflow de limpeza.

## Removido

- Botão "Destacar na vitrine" + textarea de nota nos três `*Admin.tsx`.
- `POST /api/admin/highlights` (rota de criação manual) — a coleta automática/hub-search (`persistItems`) é o único caminho de escrita agora.
- Página `/admin/vitrine` (tela de curadoria separada) — cada hub já mostra e permite remover os itens do seu próprio marketplace; `GET /api/admin/highlights` e `DELETE /api/admin/highlights/[id]` continuam existindo (moderação, ver seção "Hub admin"), só a tela dedicada some.
- Model `Product` do schema (`prisma/schema.prisma`). O enum `ProductSource` **não** é removido — `PostDraft.source` também o usa.
- Botão "Gerar link" e todo o fluxo de geração manual de link no hub ML, junto do model `MercadoLivreGeneratedLink` e da rota `POST /api/admin/mercadolivre/generate-link` — ver seção "Particularidade do Mercado Livre: link gerado, não estático" abaixo.

## Testes

- `persistItems`: filtra item sem imagem/preço inválido; dedup por `(marketplace, productId)` não duplica em chamadas sucessivas; atribui nota do pool.
- `collectAmazon`/`collectMercadoLivre`/`collectShopee`: mockam os hub clients existentes, cobrem paginação até 50 itens e propagação de erro de sessão expirada como `CollectResult.error` (sem lançar, pra não derrubar `Promise.allSettled`).
- `POST /api/cron/collect`: 401 sem secret; chama os três coletores; resposta reflete sucesso parcial quando um marketplace falha.
- `startOfTodayInBrazil` (corte 5h): teste cobrindo os dois lados da fronteira (23h de ontem → corte é 5h de ontem; 6h de hoje → corte é 5h de hoje).
- `GET /` paginação: página 2 não repete itens da página 1; página além do total retorna lista vazia sem erro.
- `GET /` filtro por marketplace: sem `filtered=1` mostra todos; com `filtered=1` e um `marketplace` mostra só esse; com `filtered=1` e nenhum `marketplace` mostra lista vazia.
- `GET /` busca por texto: `q` filtra por substring case-insensitive no título; combinado com filtro de marketplace, aplica os dois (AND); `q` vazio não filtra.
- `POST /api/cron/highlights-cleanup`: só remove `Highlight` com `createdAt` antes do corte de hoje 5h.
- `DELETE /api/admin/highlights/[id]`: comportamento inalterado (já existe, coberto por `tests/api/admin/highlights` atuais) — remove o item de moderação a partir de um hub, sem depender de `/admin/vitrine`.

## Verificação manual

1. Rodar a migração (novo `productId` em `Highlight`, remoção de `Product`/`ProductSource`) contra Neon.
2. Popular a lista de termos e o pool de 50 notas genéricas.
3. Disparar `POST /api/cron/collect` manualmente (com o secret) e confirmar que `Highlight` recebe itens dos três marketplaces (ou falha isolada só no marketplace com sessão expirada).
4. Abrir `/` e confirmar 30 itens por página, com nota, imagem, preço e link de afiliado funcional.
4b. Marcar só "Shopee" e confirmar que só itens Shopee aparecem; marcar "Shopee" + "Mercado Livre" e confirmar que Amazon some; desmarcar tudo e confirmar lista vazia; buscar um termo do título e confirmar que só itens compatíveis aparecem, combinando com o filtro de marketplace.
5. Abrir cada hub admin e confirmar que carrega automaticamente os itens do pool, e que uma busca manual nova também aparece na vitrine pública na atualização seguinte.
6. Disparar `POST /api/cron/highlights-cleanup` manualmente e confirmar que só remove itens antigos (antes do corte de 5h), preservando os de hoje.
7. Confirmar que os workflows do GitHub Actions (`collect.yml` a cada 20 min, `highlights-cleanup.yml` às 5h com os dois steps) estão configurados e habilitados.
