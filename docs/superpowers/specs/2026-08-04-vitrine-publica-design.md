# Vitrine pública — Design

Data: 2026-08-04

## Objetivo

Abrir uma página pública ("vitrine") em `/` mostrando as ofertas que o usuário escolheu destacar no dia, com curadoria manual diária feita no admin. Hoje toda a aplicação (inclusive `/`) fica atrás do login admin; este design define como abrir só essa parte com segurança, sem enfraquecer a proteção do resto do admin.

## Por que curadoria manual (e não só o score da IA)

O spec original previa a vitrine como leitura direta do pipeline automático de score, com aprovação manual fora do MVP. Decisão revista: o usuário quer escolher manualmente quais ofertas aparecem, então a vitrine passa a depender de uma ação humana nova (marcar "destaque do dia"), não só do score.

## Por que só o dia atual (sem histórico acumulado)

Links de afiliado têm validade. Manter destaques de dias anteriores visíveis correria o risco de exibir um link já expirado. A vitrine mostra só itens com `featuredAt` dentro do dia corrente; itens de dias passados somem da página (permanecem no banco).

## Modelo de dados

Novo campo em `Product`:

```prisma
model Product {
  // ...campos existentes
  featuredAt DateTime?
}
```

`featuredAt` é independente do `posted` existente (que trata de distribuição/Telegram, não da vitrine).

## Curadoria (admin)

- Nova página `/admin/vitrine`, adicionada ao `AdminNav` junto de "Postar" e "Hub Mercado Livre".
- Lista os produtos elegíveis (aprovados pelo filtro/score, não reprovados) com um toggle "destacar" / "remover destaque".
- Nova rota `POST /api/admin/products/[id]/feature`, protegida pelo mesmo gate de sessão admin (`isAuthorizedAdminRequest`, já usado em outras rotas `/api/admin/*`). Toggle liga `featuredAt = new Date()` / desliga `featuredAt = null`.
- Sem histórico de curadoria no MVP — o toggle é o estado atual, ponto.

## Vitrine pública

- `/` deixa de redirecionar e passa a ser a própria página pública (Server Component), substituindo o placeholder atual de `create-next-app` em `src/app/page.tsx`.
- Consulta dedicada `getFeaturedToday()` em `src/lib/products/`, com **whitelist explícita de campos** — nunca reaproveita a query/seleção usada no admin:
  - `title`, `image`, `price`, `oldPrice`, `discount`, `score`, `marketplace`, `affiliateLink`
  - Exclui explicitamente: `productId`, `seller`, `description`, `reviews`, `id` interno do banco, e qualquer outro campo não listado.
- Filtro: `featuredAt >= início do dia atual (America/Sao_Paulo)` e `featuredAt < início do dia seguinte`.
- Sem busca, filtro ou paginação — lista simples, como já definido no spec original.
- Tema visual claro (light), distinto do tema escuro usado no `/admin` — detalhamento de UI fica para a fase de implementação.

## Middleware (`src/proxy.ts`)

Estado atual: o `matcher` só intercepta `["/", "/admin/:path*", "/api/admin/:path*"]`. Qualquer rota nova que alguém esqueça de adicionar a essa lista fica pública por padrão — frágil à medida que o admin cresce.

Mudança:
- `/` sai do matcher e da lógica de redirecionamento — vira uma rota pública comum, servida normalmente pelo Next.js sem passar pelo middleware.
- O `matcher` passa a cobrir amplamente as rotas da aplicação, excluindo apenas assets estáticos (`_next/static`, `_next/image`, favicon, etc.) — usando o padrão de exclusão recomendado pelo Next.js para middleware.
- Dentro do middleware, a checagem é por prefixo: `pathname.startsWith("/admin")` ou `pathname.startsWith("/api/admin")` exige sessão válida (mesma lógica de hoje, sem `/` como caso especial); qualquer outro path passa direto.
- Resultado: novas páginas públicas (ex.: a própria vitrine) não exigem nenhuma alteração no middleware; novas páginas admin precisam nascer sob `/admin` ou `/api/admin` para herdar a proteção — convenção de pasta em vez de lista manual.

## Login hardening

Dois problemas identificados na auditoria deste design, ambos em `src/lib/adminAuth.ts` / `src/app/api/auth/login/route.ts`:

1. **Comparação de senha não é *timing-safe***: `isValidAdminCredentials` usa `===` para comparar usuário e senha. Trocar por `timingSafeEqual` (mesmo padrão já usado em `adminSession.ts` para o token de sessão), com buffers de tamanho igual (preenchendo/hasheando antes de comparar, para não vazar o tamanho da senha correta via erro de tamanho).
2. **Sem rate limiting**: qualquer IP pode tentar senhas indefinidamente. Nova tabela Prisma:

```prisma
model LoginAttempt {
  id          String   @id @default(cuid())
  ip          String
  windowStart DateTime
  count       Int      @default(1)

  @@unique([ip, windowStart])
}
```

- Janela de 15 minutos, arredondada (ex.: trunca o timestamp para o início do bloco de 15 min) para simplificar a chave de unicidade.
- Limite: 5 tentativas falhas por IP por janela. Ao exceder, `POST /api/auth/login` responde `429` sem sequer checar a senha.
- Escolhido Postgres (Neon, já usado no projeto) em vez de memória em processo: funções serverless da Vercel não compartilham estado entre instâncias, então um `Map` em memória não limitaria nada de forma confiável.
- Tentativas bem-sucedidas não precisam limpar o contador — a janela expira sozinha; simplicidade sobre otimização.

## Fora de escopo (YAGNI para este design)

- Proteção anti-scraping na vitrine: o objetivo da página é justamente atrair tráfego público; não faz sentido dificultar o acesso ao próprio conteúdo que se quer divulgar.
- Histórico de curadoria (quem destacou o quê, quando) — não pedido, sem caso de uso claro ainda.
- Rate limiting em rotas públicas de leitura — sem evidência de abuso, revisitar se o tráfego real justificar.

## Testes

- `isValidAdminCredentials`: comportamento inalterado nos testes existentes (`tests/lib/adminAuth.test.ts`), mais um teste garantindo que a comparação não deixa de ser *timing-safe* para senhas de tamanhos diferentes.
- Rate limiting do login: teste cobrindo bloqueio após 5 falhas na mesma janela e liberação após a janela expirar.
- `getFeaturedToday()`: teste garantindo que só retorna os campos da whitelist e só itens com `featuredAt` no dia atual.
- Toggle admin (`/api/admin/products/[id]/feature`): teste de autorização (401 sem sessão) e de comportamento (liga/desliga `featuredAt`).
- `src/proxy.ts`: atualizar `tests/proxy.test.ts` para refletir que `/` não redireciona mais e que a proteção por prefixo cobre rotas `/admin`/`/api/admin` não listadas explicitamente antes.
