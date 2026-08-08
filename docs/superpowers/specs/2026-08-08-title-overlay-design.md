# Título no topo da imagem gerada — Design

Data: 2026-08-08

## Contexto

Hoje, ao clicar em "Selecionar para postar" (Amazon/Shopee/Mercado Livre), o item vira um `PostDraft` direto, sem etapa de confirmação. As imagens finais (story/feed) são geradas por `composeStory`/`composeFeedSlide` (`src/lib/postdraft/images.ts`), que já compõem produto + moldura + pill de preço (story) ou produto + selo (feed), mas não têm nenhum texto do título do produto.

O usuário quer poder revisar/editar o título do produto no momento da seleção, e que esse texto apareça no topo da imagem gerada (story e feed), sem alterar o `title` já usado em outros lugares (ex: legenda do carrossel, listagem em `PostarQueue`).

## Objetivo

Ao clicar em "Selecionar para postar", abrir um modal pré-preenchido com o título do card, editável. O texto confirmado é salvo como um campo novo (`imageTitle`) no `PostDraft` e desenhado no topo do story e do feed, como texto puro com sombra/contorno (sem faixa de fundo), quebrando em até 2-3 linhas e reduzindo a fonte se necessário para caber.

## Escopo

**Dentro:**
- Modal de confirmação/edição de título, reutilizado pelos três admins (Amazon, Shopee, Mercado Livre).
- Campo `imageTitle` (nullable) no `PostDraft`.
- Overlay de texto no topo do story e do feed usando `imageTitle` (com fallback para `title` em registros antigos, onde `imageTitle` é `null`).
- Quebra de linha e auto-redução de fonte para títulos longos.

**Fora:**
- Edição do `imageTitle` depois da seleção (ex: na tela Postar) — fica fixo após confirmado no modal.
- Qualquer mudança em `PostDraft.title` ou nos lugares que já o usam (legenda, listagem).
- Mudança de layout/posição da moldura, pill de preço ou selo.

## Mudanças

### 1. Schema

`prisma/schema.prisma`, modelo `PostDraft` ganha:

```prisma
imageTitle String?
```

Nullable — evita migração destrutiva em linhas existentes (que não têm valor pra essa coluna) e permite fallback simples.

### 2. Modal `PostTitleModal` (novo, compartilhado)

Componente client, algo como `src/app/admin/PostTitleModal.tsx`: input de texto pré-preenchido com o título do card, botões "Cancelar"/"Confirmar". Segue o estilo visual já usado nos admins (bordas `ink-line`, fundo `ink-raised`, tipografia `font-mono`/`font-display` como no resto do painel).

`AmazonAdmin.tsx`, `ShopeeAdmin.tsx` e `MercadoLivreAdmin.tsx`: o clique em "Selecionar para postar" passa a abrir o modal (estado `itemPendingTitle: PoolItem | null`) em vez de chamar `handleSelectForPost` direto. Ao confirmar, `handleSelectForPost(item, imageTitle)` roda com o texto do modal, incluindo `imageTitle` no corpo do POST.

### 3. API `POST /api/admin/postdraft`

`src/app/api/admin/postdraft/route.ts`: aceita `imageTitle` (string, obrigatória e não vazia — o modal sempre garante um valor, já que vem pré-preenchido), valida como as demais strings, repassa para `createPostDraft`.

`src/lib/postdraft/store.ts`: `CreatePostDraftInput` ganha `imageTitle: string`, incluído no `prisma.postDraft.create`.

### 4. Overlay de título (`src/lib/postdraft/images.ts`)

Nova função `drawTitleLayer(title, canvasWidth, canvasHeight)`, no mesmo molde de `drawPricePillLayer` (canvas 2D, fonte Archivo Black já registrada): texto centralizado, sem fundo, com sombra escura (`ctx.shadowColor`/`shadowBlur`) para legibilidade sobre qualquer imagem de produto. Quebra em até 3 linhas dentro da largura útil do canvas (com margem lateral); se não couber em 3 linhas no tamanho de fonte inicial, reduz o tamanho até caber. Posicionado no topo, acima da imagem do produto.

`composeStory` e `composeFeedSlide` ganham parâmetro `title: string` e chamam `drawTitleLayer` por último (por cima de moldura/pill ou selo), garantindo que o texto nunca fique coberto.

### 5. Rotas de imagem

`src/app/api/admin/postdraft/[id]/story/route.ts` e `.../feed/route.ts`: passam `postDraft.imageTitle ?? postDraft.title` para `composeStory`/`composeFeedSlide`.

## Validação e limites

- `imageTitle` vazio ou ausente no POST → `400 invalid_body`, mesmo padrão dos outros campos obrigatórios.
- Registros antigos (`imageTitle` null) continuam gerando imagem normalmente, usando `title` como texto do overlay.
- Título vazio nunca chega ao overlay porque o modal exige preenchimento antes de confirmar (input `required`, botão "Confirmar" desabilitado se vazio).

## Testes

- `drawTitleLayer`/quebra de linha: teste unitário verificando que títulos curtos ficam em 1 linha e títulos longos quebram em até 3 linhas sem estourar a largura do canvas.
- `composeStory`/`composeFeedSlide`: teste existente (se houver) estendido para cobrir a nova assinatura com `title`.
- Rotas `story`/`feed`: teste garantindo fallback para `title` quando `imageTitle` é `null`.

## Verificação manual

1. Em qualquer um dos três admins, clicar em "Selecionar para postar" num item — confirmar que o modal abre pré-preenchido com o título do card.
2. Editar o texto e confirmar — conferir que o item aparece na fila (`/admin/postar`) e que a imagem de story e feed geradas mostram o texto editado no topo, legível sobre a imagem do produto.
3. Confirmar sem editar — o texto original do card aparece no topo da imagem.
4. Testar um título bem longo — confirmar que quebra em várias linhas (até 3) e não estoura a largura da imagem.
