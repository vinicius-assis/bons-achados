# Timestamp de preço nos cards da vitrine — Design

Data: 2026-08-07

## Contexto

Revisão da política do Programa de Associados/Influencers Amazon (guia em amazon.com.br) exige que preço/disponibilidade mostrados venham acompanhados de data/hora, para não dar a impressão de que uma oferta expirada ainda é válida:

> "Incluir uma data/hora ao lado das informações de preço ou disponibilidade em seu site. Exemplo: Preço: $32,77 em 07/01/2024."
> "NÃO É PERMITIDO: Publicar links de afiliados ou conteúdo promocional que apresente ofertas da Amazon que não são mais aplicáveis ao produto ou não apresentem um carimbo de hora ou data."

Hoje (`src/app/VitrineHighlights.tsx`) o card mostra preço e preço antigo riscado sem nenhum indicador de quando aquele valor foi capturado.

### Causa raiz

`Highlight` (`prisma/schema.prisma`) tem `createdAt DateTime @default(now())`, preenchido uma única vez na criação (`prisma.highlight.create`, `src/lib/highlights/store.ts`) e nunca atualizado depois — não existe rota de edição de highlight. `listTodaysHighlights` já filtra por `createdAt >= startOfTodayInBrazil()` e `deleteStaleHighlights` remove qualquer highlight mais antigo que hoje. Ou seja, `createdAt` já é, na prática, o momento exato da captura do preço exibido, e a vitrine pública só mostra ofertas do dia corrente — mas esse dado nunca chega à UI.

## Objetivo

Exibir a hora de captura do preço em cada card, satisfazendo o requisito de timestamp da política, sem introduzir campo novo no banco.

## Escopo

**Dentro:**
- Helper de formatação de hora em horário de Brasília.
- Exibição de "Preço às HH:mm" em cada card da vitrine pública, ao lado do preço.

**Fora:**
- Campo `updatedAt` ou qualquer refresh de preço — os highlights não são editados hoje; se isso mudar no futuro, é um design separado.
- Mudança de schema — `createdAt` já serve para esse propósito.

## Mudanças

### 1. Helper de horário

`src/lib/date.ts` ganha:

```ts
export function formatBrazilTime(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
```

### 2. Exibição no card

`src/app/VitrineHighlights.tsx`, na linha de preço (mesmo bloco de `formatPrice(highlight.price)` / `oldPrice` riscado), adiciona um `<span>` com o mesmo estilo discreto usado em "Link patrocinado" (`font-mono text-[10px] text-ink/50`):

```
Preço às {formatBrazilTime(highlight.createdAt)}
```

Posicionado depois do bloco de preço/preço antigo, na mesma linha ou logo abaixo (ajuste visual fica a critério da implementação, mantendo o card compacto).

## Validação e limites

Nenhuma validação nova — `createdAt` já é garantido pelo Prisma (`@default(now())`), sempre presente.

## Testes

- `formatBrazilTime`: teste unitário puro, formata um `Date` fixo (ex: `2026-08-07T17:32:00Z` → `"14:32"`, considerando UTC-3).
- Sem teste de UI automatizado novo (projeto não tem suíte de UI para a vitrine hoje) — verificação manual do card renderizado faz parte da implementação.

## Verificação manual

1. Abrir a vitrine pública com pelo menos um highlight do dia e confirmar que "Preço às HH:mm" aparece perto do preço, com a hora coerente com o horário de Brasília.
