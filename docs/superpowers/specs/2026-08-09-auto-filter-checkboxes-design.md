# Filtro automático nos checkboxes de marketplace — Design

Data: 2026-08-09

## Contexto

A vitrine (`src/app/page.tsx`) tem um formulário GET com checkboxes de marketplace (Mercado Livre, Amazon, Shopee), campo de busca por texto e botão "Filtrar". Hoje, marcar ou desmarcar um checkbox não tem efeito nenhum até o usuário clicar em "Filtrar" — o que é confuso, já que o gesto de marcar/desmarcar parece uma ação completa por si só.

## Objetivo

Marcar/desmarcar um checkbox de marketplace já aplica o filtro na hora (recarrega a página com os novos parâmetros). O campo de busca por texto continua exigindo Enter ou clique em "Filtrar" — não deve recarregar a cada tecla digitada.

## Escopo

**Dentro:**
- Auto-submit do formulário ao mudar qualquer checkbox de marketplace.

**Fora:**
- Qualquer mudança no comportamento do campo de busca por texto ou do botão "Filtrar".
- Mudança na lógica de paginação, filtragem no banco (`listHighlightsPage`) ou no parsing de `searchParams` em `page.tsx`.
- Mudança visual/estilo do formulário.

## Mudanças

### 1. Novo componente `src/app/FilterForm.tsx` (client)

Extrai o `<form method="get">` hoje inline em `page.tsx` (linhas 100-135) para um Client Component. Recebe como props os mesmos dados que `page.tsx` já calcula: `marketplaces: Marketplace[]` (selecionados) e `q: string`. Renderiza exatamente o mesmo HTML de hoje (hidden `filtered=1`, checkboxes, input de texto, botão "Filtrar"), sem mudança visual.

Cada checkbox ganha `onChange={(e) => e.currentTarget.form?.requestSubmit()}` — dispara a submissão nativa do form (GET), que já substitui a query string inteira (resetando `page` automaticamente, mesmo comportamento que clicar em "Filtrar" já tem hoje).

### 2. `src/app/page.tsx`

Substitui o JSX inline do formulário por `<FilterForm marketplaces={marketplaces} q={q} />`. Nenhuma outra mudança na página.

## Validação e limites

- Sem JS habilitado, os checkboxes voltam ao comportamento atual (precisa clicar "Filtrar") — degradação graciosa, não regressão.
- Múltiplos cliques rápidos em checkboxes diferentes: cada `requestSubmit()` dispara uma navegação nova, que o navegador cancela a anterior automaticamente — sem necessidade de debounce.

## Testes

- Sem teste automatizado novo — mudança é puramente de interação client-side num Server Component já coberto por navegação real de navegador. Verificação manual cobre o comportamento.

## Verificação manual

1. Na vitrine, com todos os marketplaces marcados, desmarcar "Amazon" — confirmar que a página recarrega na hora e a lista já reflete só Mercado Livre/Shopee, sem precisar clicar em "Filtrar".
2. Digitar algo no campo de busca sem apertar Enter — confirmar que nada acontece até apertar Enter ou clicar "Filtrar".
3. Marcar/desmarcar um checkbox com texto já digitado no campo de busca — confirmar que o texto é preservado no filtro aplicado.
