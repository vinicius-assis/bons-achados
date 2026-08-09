# Cadastro manual de itens — Design

Data: 2026-08-09

## Objetivo

Hoje o cadastro de ofertas Amazon/Shopee depende dos hubs `/admin/amazon` e
`/admin/shopee`, que raspam a vitrine do marketplace via sessão de cookies. Não
existe um jeito de colar manualmente um item pontual (link de imagem, nome,
preço, desconto, link de afiliado) sem passar pela raspagem — o formulário
manual que o spec original (`2026-08-01-bons-achados-design.md`) previa nunca
foi construído. Este design adiciona esse formulário, cobrindo os três
marketplaces com detecção automática de qual é qual a partir do link de
afiliado.

## Localização

Página nova: `/admin/cadastro`. Link "Cadastro manual" adicionado ao
`AdminNav` (`src/app/admin/AdminNav.tsx`), entre "Hub Shopee" e "Postar".

## Formulário

Multi-item: uma ou mais linhas na mesma submissão, cada linha com:

- **Link da imagem** (texto, obrigatório)
- **Nome** (texto, obrigatório)
- **Preço** (número, obrigatório, > 0)
- **Desconto** (número, opcional — porcentagem digitada direto, ex.: `30` = 30%)
- **Link afiliado** (texto, obrigatório)
- Checkbox **"também adicionar para postar"**

Botão "+ adicionar item" insere uma nova linha vazia; cada linha tem um botão
"remover" (exceto quando só resta uma). Um único botão "Cadastrar" no fim
submete todas as linhas de uma vez.

Assim que o link afiliado de uma linha bate com um dos três padrões
reconhecidos, a linha mostra um badge de leitura com o marketplace detectado
(Mercado Livre / Amazon / Shopee). Não há seletor manual de marketplace — a
detecção é sempre automática, pelo link.

### Padrões de detecção

| Marketplace | Padrão do link afiliado |
|---|---|
| Mercado Livre | `https://meli.la/...` |
| Shopee | `https://s.shopee.com.br/...` |
| Amazon | `https://www.amazon.com.br/dp/<ASIN>...` |

## Backend

### `POST /api/admin/manual-items`

Body: `{ items: [{ imageLink, name, price, discount, affiliateLink, addToPost }] }`.

Para cada item, na ordem enviada:

1. **Detecta o marketplace** pelo padrão do link afiliado (tabela acima). Se
   nenhum padrão bater, o item entra no resultado como
   `{ status: "unrecognized_link" }` e a request inteira é rejeitada sem
   cadastrar nada da leva — link não reconhecido é erro de entrada, não vale a
   pena cadastrar parcialmente uma leva com um item errado no meio.
2. **Extrai o `productId`** do link afiliado:
   - Amazon: ASIN do trecho `/dp/<ASIN>`.
   - Shopee: código do path depois de `s.shopee.com.br/`.
   - Mercado Livre: slug do path depois de `meli.la/`.
   - Se a extração falhar (formato inesperado dentro do padrão já reconhecido),
     usa um id aleatório (`cuid`) como fallback — não bloqueia o cadastro.
3. **Gera a nota** com `pickRandomNote()` (`src/lib/highlights/noteTemplates.ts`),
   mesmo pool usado pelos itens raspados automaticamente.
4. **Cria o Highlight** via `createHighlight` (`src/lib/highlights/store.ts`),
   com `oldPrice: null` (o formulário não coleta preço antigo, só desconto
   direto). Se já existir um Highlight com o mesmo `[marketplace, productId]`,
   este item específico entra no resultado como `{ status: "duplicate" }` —
   mas, diferente do link não reconhecido, **não bloqueia os outros itens da
   leva** que não colidem, porque duplicata é um caso esperado (ex.: recadastrar
   por engano) e não motivo pra descartar itens válidos junto.
5. Se `addToPost` for `true` e o Highlight tiver sido criado com sucesso,
   também cria um `PostDraft` via `createPostDraft`
   (`src/lib/postdraft/store.ts`), com `imageTitle` = mesmo valor de `name`
   (editável depois manualmente na fila `/admin/postar`, sem modal aqui — não
   faz sentido pedir confirmação item a item num cadastro em lote).

Resposta: `{ results: [{ status: "created" | "created_and_queued" | "duplicate" | "unrecognized_link", ... }] }`,
uma entrada por item na mesma ordem enviada.

### Validação passo 1 vs passo 2-5

O passo 1 (detecção de marketplace) roda para **todos** os itens antes de
qualquer escrita no banco. Só depois de confirmar que todos os links são
reconhecíveis é que os passos 2-5 rodam item a item. Isso garante o
comportamento "tudo ou nada" só para o caso de link não reconhecido, mantendo
duplicata como erro parcial (por item).

## Frontend — feedback de resultado

Após o `POST`, cada linha do formulário recebe um selo de status ao lado:

- ✓ **Cadastrado** — Highlight criado.
- ✓ **Cadastrado + na fila** — Highlight e PostDraft criados.
- ⚠ **Duplicado** — já existe um Highlight com esse marketplace + productId.
- ⚠ **Link não reconhecido** — nenhum padrão bateu (só aparece se a leva
  inteira foi rejeitada no passo 1; nesse caso nenhuma linha é limpa, pra dar
  chance de corrigir o link errado e reenviar).

Linhas com sucesso (`created` / `created_and_queued`) somem do formulário após
alguns segundos ou ao reenviar; linhas com erro continuam editáveis.

## Fora de escopo

- Editar um Highlight/PostDraft já criado a partir desta tela (isso já existe
  nas outras telas: hub do marketplace remove Highlight, `/admin/postar` edita
  a fila).
- Suporte a outros marketplaces além dos três já existentes.
- Upload de imagem — o campo é sempre uma URL colada, igual ao resto do app.
