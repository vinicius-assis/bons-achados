# Vitrine pública — Design

Data: 2026-08-04

## Objetivo

Abrir uma página pública ("vitrine") em `/` mostrando as ofertas que o usuário escolheu destacar no dia, com curadoria manual diária feita no admin. Hoje toda a aplicação (inclusive `/`) fica atrás do login admin; este design define como abrir só essa parte com segurança, sem enfraquecer a proteção do resto do admin.

## Por que curadoria manual (e não só o score da IA)

O spec original previa a vitrine como leitura direta do pipeline automático de score, com aprovação manual fora do MVP. Decisão revista: o usuário quer escolher manualmente quais ofertas aparecem, então a vitrine passa a depender de uma ação humana nova (marcar "destaque do dia"), não só do score.

## Por que só o dia atual (sem histórico acumulado)

Links de afiliado têm validade. Manter destaques de dias anteriores visíveis correria o risco de exibir um link já expirado. A vitrine mostra só itens com `createdAt` dentro do dia corrente; itens de dias passados somem da página (até serem apagados pela limpeza diária, ver "Limpeza diária").

## Modelo de dados

Por que não `Product.featuredAt`: produtos manuais (Amazon/Shopee) hoje **não passam pela tabela `Product`** — o cadastro manual (`/admin/produtos/novo`) grava direto em `PostDraft` (ver `2026-08-03-gerador-de-posts-design.md`), que não tem conceito de ID estável do marketplace. Um produto manual recadastrado amanhã com um link de afiliado novo não tem como ser reconhecido como "o mesmo produto" — e a decisão aqui é não tentar: cada seleção manual é tratada como independente, mesmo que seja "o mesmo" produto de ontem.

Isso descarta acoplar a vitrine ao `Product` (que só cobriria o fluxo automático do ML). Solução: nova tabela independente, no mesmo padrão já usado pelo `PostDraft` (dado denormalizado, sem FK, com limpeza diária por cron):

```prisma
model Highlight {
  id            String      @id @default(cuid())
  marketplace   Marketplace
  title         String
  affiliateLink String
  image         String
  price         Float
  oldPrice      Float?
  discount      Float?
  createdAt     DateTime    @default(now())

  @@index([createdAt])
}
```

- Cada linha é um destaque independente — sem relação com `Product` nem `PostDraft`. Guarda só os campos que a vitrine pública exibe (nada de `seller`, `description`, `reviews`, IDs internos do marketplace).
- Sem `score`: a curadoria aqui é manual (o usuário decide o que destacar), não vem do pipeline de IA — campo omitido para não sugerir uma pontuação que não existe para itens manuais.

## Curadoria (admin)

- Nova página `/admin/vitrine`, adicionada ao `AdminNav` junto de "Postar" e "Hub Mercado Livre" — lista os destaques ativos (de hoje) com botão para remover.
- Três pontos de entrada para criar um destaque, cada um um botão nas telas que já existem:
  - **Hub Mercado Livre** (`/admin/mercadolivre`): botão "Destacar na vitrine" em cada card, ao lado do já existente "Selecionar para postar" — usa os mesmos dados já exibidos no card.
  - **Cadastro manual** (`/admin/produtos/novo`): checkbox/botão "Destacar na vitrine" por linha, além do já existente envio pra `PostDraft`.
  - **Fila de postar** (`/admin/postar`): botão "Destacar na vitrine" por item da fila ativa — útil pra revisar o que já foi selecionado pro Instagram e escolher um subconjunto pra vitrine antes de postar.
- Como `Highlight` não tem relação (FK) com `PostDraft`, o botão "Limpar lista" em `/admin/postar` (que marca `postedAt` nos `PostDraft`s) não afeta os destaques já criados — um item continua na vitrine mesmo depois de sumir da fila de postar.
- Rotas protegidas pelo mesmo gate de sessão admin (`isAuthorizedAdminRequest`):
  - `POST /api/admin/highlights` — cria um destaque.
  - `DELETE /api/admin/highlights/[id]` — remove (desmarca) um destaque do dia.
  - `GET /api/admin/highlights` — lista os destaques ativos (hoje), para a tela `/admin/vitrine`.
- Sem checagem de duplicidade no MVP: diferente do `PostDraft`, aqui repetir o mesmo produto no mesmo dia é permitido (o usuário decidiu que cada seleção é independente) — se acontecer, a vitrine só mostra o item duas vezes, o que é um problema cosmético menor, não um bug de dados.

## Vitrine pública

- `/` deixa de redirecionar e passa a ser a própria página pública (Server Component), substituindo o placeholder atual de `create-next-app` em `src/app/page.tsx`.
- Consulta `listTodaysHighlights()` em `src/lib/highlights/`, filtrando `createdAt` dentro do dia atual (America/Sao_Paulo) — mesmo helper `startOfTodayInBrazil()` já usado em `src/lib/postdraft/store.ts` (extrair para um módulo compartilhado, ex. `src/lib/date.ts`, em vez de duplicar).
- Como a tabela `Highlight` só guarda campos já públicos por natureza, não precisa de whitelist na query — mas o `select` explícito no Prisma continua sendo boa prática (evita quebrar se o modelo ganhar campos internos no futuro).
- Sem busca, filtro ou paginação — lista simples, como já definido no spec original.
- Tema visual claro (light), distinto do tema escuro usado no `/admin` — detalhamento de UI fica para a fase de implementação.

## Limpeza diária

Cron diário (GitHub Actions, mesmo padrão do cleanup de `PostDraft` em `/api/cron/postdraft-cleanup`) chama uma rota nova `/api/cron/highlights-cleanup`, protegida por secret (`POSTDRAFT_CLEANUP_SECRET` ou um novo secret dedicado — decidir na fase de implementação), que apaga todo `Highlight` com `createdAt` anterior ao dia atual em America/Sao_Paulo.

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
- `listTodaysHighlights()`: teste garantindo que só retorna itens com `createdAt` no dia atual.
- Rotas de `Highlight` (`POST`/`DELETE`/`GET /api/admin/highlights`): teste de autorização (401 sem sessão) e de comportamento (cria, lista, remove) — mesmo padrão de `tests/api/admin/postdraft/*`.
- Rota de limpeza diária (`/api/cron/highlights-cleanup`): mesmo padrão de `tests/api/cron/postdraft-cleanup.test.ts` — só apaga registros de dias anteriores, preservando os do dia corrente.
- `src/proxy.ts`: atualizar `tests/proxy.test.ts` para refletir que `/` não redireciona mais e que a proteção por prefixo cobre rotas `/admin`/`/api/admin` não listadas explicitamente antes.
