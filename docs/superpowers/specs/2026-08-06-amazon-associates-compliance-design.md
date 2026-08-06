# Correção para reaplicação ao Programa de Associados Amazon — Design

Data: 2026-08-06

## Contexto

A Amazon fechou a conta de associado (`bonsachados0f-20`) por dois motivos, citados no e-mail de rejeição:

1. **Sem ID de rastreamento nos links**: pelo menos parte dos links Amazon publicados no site não continha a tag de afiliado (`tag=bonsachados0f-20`), impedindo a Amazon de atribuir tráfego à conta.
2. **Conteúdo insuficiente**: o site (`https://bons-achados-teal.vercel.app/`) não oferece informação original/valiosa por oferta — hoje é uma grade de imagem + título truncado + preço + link.

### Causa raiz (confirmada por investigação de código)

- Existem dois caminhos para cadastrar produto Amazon: o **hub automático** (`/admin/amazon`, via `src/lib/amazon/hubClient.ts`), que monta o link com a tag corretamente (`buildAffiliateLink`, sempre inclui `?tag=`), e o **formulário manual** (`src/app/admin/produtos/novo/NovoProdutoForm.tsx`), um campo de texto livre onde o operador cola o link à mão, sem qualquer validação client ou server. O formulário manual existe desde 2026-08-03; a tag e o hub só existem desde 2026-08-05 — ou seja, qualquer produto Amazon cadastrado manualmente nesses dois dias (ou depois, se usado em vez do hub) pode ter ido ao ar sem a tag.
- A página pública (`src/app/page.tsx`), único endpoint visível a um revisor, renderiza cards do model `Highlight` (`prisma/schema.prisma`) que só tem `title`, `price`, `oldPrice`, `discount`, `image`, `affiliateLink` — nenhum campo de texto/descrição. Não há conteúdo original em nenhum marketplace (ML, Amazon ou Shopee).

## Objetivo

Eliminar as duas causas antes de reenviar a candidatura ao Programa de Associados Amazon.

## Escopo

**Dentro:**
- Amazon: cadastro de produto passa a ser exclusivo do hub automático; formulário manual perde a opção Amazon.
- Limpeza dos highlights Amazon já publicados (podem ter link sem tag).
- Campo de conteúdo original (`note`) obrigatório ao destacar uma oferta na vitrine — aplicado aos três marketplaces (ML, Amazon, Shopee), já que a rejeição por conteúdo insuficiente foi sobre o site inteiro, não só a seção Amazon.

**Fora:**
- Validação de link do Shopee (mantém formulário manual como está — risco aceito, não foi o que a Amazon reprovou).
- Campo de nota em `PostDraft` (usado para Telegram/Instagram, não é a superfície que a Amazon revisa).
- Auditoria retroativa de conteúdo em highlights antigos de ML/Shopee — a vitrine já só mostra highlights de "hoje" (`listTodaysHighlights`), então esses somem sozinhos com o tempo.

## Mudanças

### 1. Remover Amazon do cadastro manual

`src/app/admin/produtos/novo/NovoProdutoForm.tsx`:
- Tipo `Marketplace` do formulário passa de `"AMAZON" | "SHOPEE"` para só `"SHOPEE"`.
- Remove a opção `<option value="AMAZON">Amazon</option>` do `<select>`.
- `emptyRow()` usa `"SHOPEE"` como valor padrão.

Nenhuma mudança nas rotas `/api/admin/postdraft` ou `/api/admin/highlights` — elas continuam aceitando `marketplace: "AMAZON"` porque o hub (`AmazonAdmin.tsx`) continua enviando isso; só o caminho manual (sem validação) deixa de existir para Amazon.

### 2. Limpar highlights Amazon publicados

Remoção one-off de todas as linhas de `Highlight` com `marketplace = 'AMAZON'` existentes no banco, via query direta (não precisa de rota/UI nova). Elas somem da vitrine pública imediatamente. `PostDraft` não é alterado.

Depois da limpeza, todo novo destaque Amazon vem exclusivamente do hub, que já garante a tag.

### 3. Campo de conteúdo original (`note`)

**Banco de dados** (`prisma/schema.prisma`): model `Highlight` ganha `note String @default("")`. O default existe só para não quebrar a migração com linhas antigas — a aplicação passa a exigir `note` preenchida em qualquer escrita nova (a API rejeita string vazia).

**Store** (`src/lib/highlights/store.ts`):
- `CreateHighlightInput` ganha `note: string`.
- `listTodaysHighlights`: o `select` passa a incluir `note`.

**Rota** (`src/app/api/admin/highlights/route.ts`):
- `note = typeof body?.note === "string" ? body.note.trim() : ""`.
- Validação: rejeita com `400 { error: "invalid_body" }` se `note` tiver menos de 15 caracteres (mesmo padrão dos outros campos obrigatórios da rota).

**UI — três pontos de entrada, todos hoje sem input de texto livre por item:**
- `src/app/admin/amazon/AmazonAdmin.tsx` (`handleHighlight`)
- `src/app/admin/mercadolivre/MercadoLivreAdmin.tsx` (`handleHighlight`)
- `src/app/admin/produtos/novo/NovoProdutoForm.tsx` (`highlightRow`)

Em cada um, o botão "Destacar na vitrine" passa a abrir um textarea inline (estado local por item) pedindo a nota antes de habilitar a confirmação; o botão só envia a requisição com `note` preenchida (mínimo 15 caracteres, replicando a checagem do servidor no client para feedback imediato).

**Página pública** (`src/app/page.tsx`): cada card passa a renderizar `highlight.note` abaixo do título (`<h2>`) e acima do preço, como um parágrafo curto.

## Validação e limites

- `note`: obrigatória, mínimo 15 caracteres (client e server). Sem máximo — texto curto e livre, não há necessidade de truncar além do que o layout do card já faz visualmente.

## Testes

- `tests/api/admin/highlights` (existente): adicionar casos para `note` ausente/curta → 400, e `note` válida → 201 com o campo persistido.
- `src/lib/highlights/store.ts`: cobrir que `note` é passada para `prisma.highlight.create` e incluída no `select` de `listTodaysHighlights`.
- Sem testes de UI automatizados novos (o projeto não tem suíte de UI para os admins hoje) — verificação manual dos três fluxos de destaque + da renderização pública faz parte do plano de implementação.

## Verificação manual antes de reaplicar

1. Rodar a limpeza dos highlights Amazon e confirmar que a vitrine pública não mostra mais nada de Amazon até novo cadastro pelo hub.
2. Cadastrar um produto Amazon via `/admin/amazon`, destacar com uma nota, confirmar que o card público mostra o texto e que o link tem `tag=bonsachados0f-20`.
3. Confirmar que o formulário manual (`/admin/produtos/novo`) não oferece mais "Amazon" como opção.
4. Reaplicar ao Programa de Associados Amazon usando o mesmo site.
