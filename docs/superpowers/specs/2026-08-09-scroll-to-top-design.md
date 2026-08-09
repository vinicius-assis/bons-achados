# Botão "voltar ao topo" — Design

Data: 2026-08-09

## Objetivo

As telas com listagem (hubs de marketplace, fila de postar, vitrine pública)
podem crescer bastante e ficar longas de rolar. Um botão fixo no canto
inferior direito, que leva de volta ao topo com um clique, evita ter que rolar
manualmente até o topo depois de navegar a lista inteira.

## Escopo

Aparece em 5 telas, todas com listagem em grade/lista:

- `/admin/mercadolivre` (`MercadoLivreAdmin.tsx`)
- `/admin/amazon` (`AmazonAdmin.tsx`)
- `/admin/shopee` (`ShopeeAdmin.tsx`)
- `/admin/postar` (`PostarQueue.tsx`)
- Vitrine pública (`VitrineHighlights.tsx`)

Não entra no layout global (`admin/layout.tsx` ou `layout.tsx` raiz) — só é
renderizado dentro de cada um dos 5 componentes acima, para não aparecer em
telas sem listagem (painel, cadastro manual, login).

## Componente

`src/components/ScrollToTopButton.tsx`, client component sem props.

- Escondido por padrão. Um listener de `scroll` (`passive: true`) mostra o
  botão quando `window.scrollY > 400`, esconde de novo abaixo desse limite.
  Transição de opacidade suave; o botão é `fixed`, então não afeta o layout do
  conteúdo enquanto escondido ou visível.
- Ao clicar, `window.scrollTo({ top: 0, behavior: "smooth" })`.
- Posição: `fixed bottom-6 right-6`, somando `env(safe-area-inset-bottom)` ao
  espaçamento inferior para não ficar colado na barra de gestos do iOS.
- Alvo de toque mínimo 44×44px (acessibilidade mobile), ícone de seta para
  cima dentro de um círculo `bg-gold`, consistente com o resto da UI.
- `z-50` para ficar acima do conteúdo da página.

## Fora de escopo

- Configuração por página (threshold, posição) — fixo e igual nas 5 telas.
- Scroll dentro de containers internos com overflow próprio (nenhuma das 5
  telas hoje rola um container interno separado da janela).
