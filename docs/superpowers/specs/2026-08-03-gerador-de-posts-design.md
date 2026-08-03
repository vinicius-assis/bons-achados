# Design: gerador de posts (Stories + Carrossel) no painel admin

Data: 2026-08-03

## Contexto

O usuário já tem um script Python standalone (`~/Documentos/Produtos/`, usando PIL) que,
a partir de um `produtos.json` com produtos afiliados e um kit de moldura/selo da marca,
gera imagens prontas pra postar no Instagram (Stories com moldura + preço, slides de
carrossel de feed com selo) e a legenda do carrossel. Ele roda manualmente, à parte do
site.

Objetivo: trazer essa geração de posts pra dentro do painel admin (`/admin`) e integrá-la
com o que já existe — hub de busca do Mercado Livre (`/admin/mercadolivre`) e um novo
cadastro manual de Amazon/Shopee, que ainda não existe no app. O usuário posta
manualmente em Instagram 3x por dia; depois de cada postagem ele limpa a fila pra não
duplicar na próxima leva.

Fora de escopo (confirmado durante o brainstorm): publicar de fato no Instagram (sem API
do Instagram aqui), a moldura lateral (variedade visual não faz sentido numa seleção
pequena e curada, ao contrário do lote diário de 24 produtos do script original), e
qualquer ligação com o pipeline de score/Telegram/site público — este é um recurso
isolado que não usa a tabela `Product` existente (reservada pro pipeline futuro descrito
em `2026-08-01-bons-achados-design.md`).

## Modelo de dados

Nova tabela `PostDraft`, independente de `Product`:

```prisma
model PostDraft {
  id            String        @id @default(cuid())
  marketplace   Marketplace   // reaproveita o enum existente (MERCADO_LIVRE | AMAZON | SHOPEE)
  source        ProductSource // reaproveita o enum existente (AUTO | MANUAL)
  title         String
  affiliateLink String
  image         String        // URL da foto do produto (não arquivo local)
  price         Float
  discount      Float?
  category      String?
  createdAt     DateTime      @default(now())
  postedAt      DateTime?     // null = está na fila ativa; preenchido = já foi usado/limpo

  @@index([affiliateLink, createdAt])
}
```

- **Fila ativa** = `PostDraft` com `postedAt IS NULL`.
- **"Limpar lista"** (botão manual na tela de postar) faz `UPDATE ... SET postedAt = now()`
  em todos os itens ativos — não apaga linhas. Isso permite checar duplicidade mesmo
  depois de já ter limpado a fila no dia.
- **Checagem de duplicidade**: antes de criar um `PostDraft` novo (form manual ou botão
  "Selecionar para postar" no hub do ML), busca por `affiliateLink` igual criado **hoje**
  (`createdAt >= início do dia em America/Sao_Paulo`), independente de `postedAt`. Se
  achar, bloqueia a criação e mostra quando foi cadastrado (`"já cadastrado hoje às
  HH:MM"`).
- **Limpeza diária**: um cron (GitHub Actions, mesmo padrão do `/api/collect`) roda às
  00:00 America/Sao_Paulo (`03:00 UTC` — Brasil não observa horário de verão desde 2019,
  então o offset é fixo) e chama uma rota protegida por secret que apaga todo
  `PostDraft` com `createdAt` anterior ao dia atual. Isso reresolve duas coisas: reseta o
  dedup pro novo dia e evita a tabela crescer indefinidamente. Não mexe na fila ativa do
  dia corrente — isso é sempre manual, via "Limpar lista".

## Telas

### 1. Cadastro manual — `/admin/produtos/novo`

Formulário pra Amazon/Shopee com os campos realmente usados (batidos com o
`produtos.json` do script Python): marketplace (Amazon/Shopee), nome, link de afiliado,
link da imagem (URL), preço, desconto em % (opcional), categoria (sugerida
automaticamente por palavra-chave no nome — porte do `categorize()` do
`lib/produtos.py` — mas editável). Suporta cadastrar mais de um produto na mesma sessão
(linhas repetíveis, cada uma um `POST` independente pra `PostDraft`).

Validação de duplicidade roda no submit de cada linha (ver acima).

### 2. Hub Mercado Livre — `/admin/mercadolivre`

Cada card de resultado ganha um botão "Selecionar para postar", que envia os dados já
exibidos no card (título, preço, desconto, imagem, link de afiliado gerado) pra criar um
`PostDraft` (`marketplace: MERCADO_LIVRE`, `source: AUTO`). Mesma checagem de
duplicidade do cadastro manual. O botão reflete o estado (ex.: vira "Já selecionado" se
aquele item já tem um `PostDraft` criado hoje).

### 3. Produtos para postar — `/admin/postar`

Lista a fila ativa (`PostDraft` com `postedAt IS NULL`, mais recentes primeiro). Pra cada
item:
- Imagem do Story (moldura diagonal + pill de preço), com botão de download.
- Imagem do slide de feed (foto + selo, canto inferior direito), com botão de download.
- Link de afiliado (copiável).

Abaixo da lista, uma legenda de carrossel única cobrindo todos os itens da fila ativa
(mesmo formato do `build_caption` do script: lista numerada nome + desconto, CTA, bloco
de hashtags por categoria/marketplace presentes), num campo de texto copiável.

Botão **"Limpar lista"** no topo: marca `postedAt = now()` em todos os itens ativos e a
tela volta a ficar vazia (com uma mensagem convidando a cadastrar/selecionar os próximos
produtos).

Link de acesso a partir do dashboard (`/admin`) e do nav compartilhado do admin
(`AdminNav.tsx`), ao lado de "Hub Mercado Livre".

## Geração de imagem

Porte do `lib/imagens.py` (PIL) pra TypeScript, usando:

- **Sharp** pra tudo que já é composição pura de imagem: redimensionar mantendo
  proporção e centralizar num canvas de fundo cinza claro (`fit_on_canvas`), sobrepor a
  moldura (`paste_overlay`), sobrepor o selo no canto inferior direito
  (`paste_selo`). Mapeamento direto: `.resize(..., { fit: "inside" })` +
  `.composite([...])`.
- **`@napi-rs/canvas`** só pro pill de preço do Story (retângulo arredondado + texto
  centralizado) — Sharp não desenha texto/formas. Espelha `draw_price_pill`: desenha o
  rounded-rect, mede o texto (`measureText`), centraliza, e essa camada entra como mais
  um `.composite()` no Sharp.
- Como as fontes do `next/font` só existem em runtime de página (browser), preciso
  baixar um arquivo estático do Archivo Black e registrá-lo no `@napi-rs/canvas` via
  `GlobalFonts.registerFromPath` pro texto do pill sair na mesma voz tipográfica do
  admin — troca a fonte substituta (Liberation Sans Bold) usada no script original.
- Assets a copiar de `~/Documentos/Produtos/molduras/` pro repo, em `assets/brand-kit/`
  (fora de `public/` pra não ficarem acessíveis publicamente sem necessidade — só o
  server precisa deles pra compor as imagens): `MOLDURA_diagonal_story_1080x1920.png` e
  `SELO_70pct_400px.png`. Só a moldura diagonal — a lateral fica de fora do MVP deste
  recurso (ver "Fora de escopo").
- Cores/dimensões do pill mantidas idênticas ao script original (`#F9B50C` de fundo,
  texto `#0D1012`, 356×113px, raio = metade da altura) — são os valores do kit de marca
  já usado nos assets prontos, não do design token `--color-gold` do admin (que é um
  tom próximo mas não idêntico).
- Formato de saída: apenas o slide de feed 1080×1350 (igual ao `main.py` original, que
  não usa a variante 1080×1080).

Nada fica salvo em disco/storage: cada imagem é servida por uma rota que gera o buffer
na hora e devolve como resposta (ex. `GET /api/admin/postar/[id]/story.jpg` e
`.../feed.jpg`), consumida pela tela como `<img src>` normal com botão de download. A
legenda (texto puro) é calculada a partir da fila ativa a cada carregamento da tela
`/admin/postar`, sem rota própria — vem junto no mesmo payload que lista a fila.

## Testes

- Porte de `lib/produtos.py` (categorização por palavra-chave) e `lib/legenda.py`
  (legenda do carrossel) → testes unitários diretos, mesma cobertura de casos que faria
  sentido no Python (categoria default "outro", desconto ausente vira "imperdivel",
  hashtags por marketplace/categoria sem duplicar).
- Composição de imagem (Sharp/`@napi-rs/canvas`) → smoke test verificando que a função
  roda sem erro e retorna um buffer de imagem válido nas dimensões esperadas; não vale a
  pena comparar pixel a pixel.
- Rotas de `PostDraft` (criar, checar duplicidade, listar fila ativa, limpar) → testes de
  API iguais ao padrão já usado nas rotas do Mercado Livre (`tests/api/admin/...`).
- Rota de limpeza diária (cron) → teste garantindo que só apaga registros de dias
  anteriores, preservando os do dia corrente independente de `postedAt`.
