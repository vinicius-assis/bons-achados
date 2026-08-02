# Bons Achados — Design (revalidado)

Data: 2026-08-01

## Objetivo

Gerar renda de afiliado (Mercado Livre, Amazon, Shopee) automatizando o máximo possível da coleta e curadoria de promoções, com IA selecionando e pontuando as melhores ofertas, e distribuição via Telegram, site público e Instagram.

Sem meta numérica fixa para o MVP. Critério de sucesso inicial: o sistema está no ar, coletando, pontuando e distribuindo ofertas de forma confiável. Cliques e comissão entram como métricas de acompanhamento em "melhorias futuras".

## Status de afiliação (contexto que molda o design)

O usuário já é afiliado aprovado em Mercado Livre, Amazon e Shopee, mas **não tem acesso liberado à API** de Amazon nem de Shopee:

- **Amazon PA-API**: exige 10 vendas qualificadas nos últimos 30 dias para liberar acesso pleno — inviável sem volume prévio.
- **Shopee Open API**: exige aprovação manual separada da conta de afiliado, prazo de até 2 semanas.
- **Mercado Livre**: API de afiliados já disponível e utilizável desde já.

Isso define a divisão automático/manual do design.

## Arquitetura geral

Uma única aplicação Next.js (API Routes + Prisma + PostgreSQL/Neon) cobre três frentes que escrevem na mesma tabela `Products`:

1. **API de coleta** (`/api/collect`) — disparada a cada 10 min por workflow do GitHub Actions, busca ofertas via API de afiliados do Mercado Livre.
2. **Formulário interno** (autenticado, uso exclusivo do usuário) — cadastro manual de ofertas Amazon/Shopee.
3. **Site público** — lista as ofertas aprovadas.

Todas passam pelo mesmo pipeline (filtro → IA → score) antes de ficarem "aprovadas" (visíveis no site, elegíveis para Telegram).

### Escalabilidade

A arquitetura é desacoplada por design: os três produtores de dados só escrevem em `Products` via API routes; trocar/adicionar fonte de dados não exige mexer no pipeline. Vercel (functions) e Neon (Postgres serverless) escalam por configuração/plano, não por redesenho. Serviços externos (IA, agendamento) são plugáveis por HTTP.

Dois limites conhecidos:

- **Prisma + Neon**: usar o connection pooler do Neon (`pgbouncer`) desde o início para evitar esgotamento de conexões sob carga.
- **Tempo de execução de função serverless na Vercel** (10s no plano gratuito): ação necessária já na primeira versão, não só se o volume crescer — com os parâmetros padrão (3 queries × até 50 resultados cada, uma chamada de avaliação por item) a rota `/api/collect` já se aproxima do limite num único ciclo. A implementação limita resultados por busca (`limit=20`) e declara `maxDuration = 60` na rota para dar folga. Se o volume crescer ainda mais, a rota migra para um worker separado fora da Vercel — como a lógica já está isolada numa API route, essa migração é localizada.

**Nota sobre o cálculo de minutos do GitHub Actions**: a estimativa de "~144 execuções/dia dentro do limite gratuito" só vale para repositório **público** — GitHub Actions é ilimitado em repositórios públicos, mas em repositório privado 144 execuções/dia × 30 dias arredondadas para cima por minuto ultrapassam facilmente as 2000 minutos/mês gratuitas. Manter o repositório público, ou aumentar o intervalo do cron, caso vire privado. Vale lembrar também que o GitHub desativa workflows agendados automaticamente após 60 dias de inatividade do repositório.

## Agendamento da coleta

**Decisão: GitHub Actions.**

| Opção | Motivo |
|---|---|
| GitHub Actions ✅ | Gratuito até 2000 min/mês (suficiente para ~144 execuções/dia de poucos segundos cada), desacoplado da Vercel |
| Vercel Cron ❌ | Plano gratuito só permite 1x/dia — não cumpre o intervalo de 10 min sem upgrade pago |
| Serviço externo de cron ❌ | Sem limite de frequência, mas adiciona dependência externa fora de controle |

Um workflow agendado (`schedule: cron`, a cada 10 min) chama `/api/collect`, protegida por secret.

## Marketplaces

### Mercado Livre — coleta automática

API oficial de afiliados. Único marketplace com integração automatizada no MVP.

Coleta: produto, imagem, link, preço, categoria, avaliações. Link de afiliado gerado automaticamente.

### Amazon — cadastro manual

Cadastro via formulário interno, já com curadoria humana. Campos: nome, preço, preço anterior (opcional), imagem, link, avaliação, categoria. Tag de afiliado adicionada automaticamente ao link.

### Shopee — cadastro manual

Cadastro via formulário interno, já com curadoria humana. Campos: produto, imagem, comissão, cupom, link, preço anterior (opcional).

> Amazon e Shopee migram para integração automática em "melhorias futuras", condicionado a: Amazon atingir volume de vendas exigido pela PA-API, ou Shopee ter API aprovada — ou via rede agregadora (ex.: Lomadee) como atalho para ambos.

## Banco de dados

### `Products`

```
id
marketplace
source          -- 'auto' | 'manual'
productId
title
description
price
oldPrice        -- opcional (nem sempre disponível na Amazon/Shopee)
discount        -- opcional
rating
reviews
image
affiliateLink
category
seller
createdAt
posted
score
```

## Pipeline

### 1. Coleta

Executa a cada 10 minutos (ML). Salva todos os produtos encontrados como `source = auto`. Cadastro manual (Amazon/Shopee) insere direto como `source = manual`, fora do ciclo de coleta.

### 2. Filtros

Regras para `source = auto` (Mercado Livre):
- desconto menor que 25%
- menos de 100 avaliações
- nota inferior a 4.5
- sem estoque

Produtos `source = manual` (Amazon/Shopee) pulam a regra de desconto mínimo — já passaram por curadoria humana no cadastro. As demais regras (avaliações, nota, estoque) continuam valendo.

### 3. IA

Recebe apenas os produtos filtrados. Analisa: desconto (quando disponível), preço, categoria, avaliações, comissão, confiabilidade, histórico de preço (futuro).

Quando `discount`/`oldPrice` não estiverem preenchidos (comum em cadastros manuais), a IA pontua com os demais critérios — a ausência do campo não zera nem penaliza o score, só deixa de somar os pontos de "desconto excelente".

### 4. Score Bons Achados

Nota final 0–100, exibida com estrelas e motivos (ex.: ✔ desconto real, ✔ excelente avaliação, ✔ frete grátis, ✔ produto confiável). Esse score é o diferencial do produto, usado tanto no site quanto nas mensagens do Telegram.

## Distribuição

### Telegram — dois destinos

- **Canal/grupo privado (uso pessoal)**: todos os dias, automaticamente, as 20 melhores promoções (por score). Serve de base para o usuário montar Stories manualmente (imagem + link de cada uma) e escolher até 3 para virarem post em carrossel no Instagram.
- **Grupo público (outras pessoas)**: todas as promoções aprovadas no filtro (não só o top 20), sem curadoria adicional — volume bruto pós-filtro.

Cada mensagem contém: imagem, preço, desconto, link, marketplace, score Bons Achados.

### Site público

Lista simples das ofertas aprovadas (imagem, preço, desconto, score, link), acumulando histórico ao longo do tempo — sem busca ou filtro no MVP. Adiado até o catálogo crescer o suficiente para justificar essas features (uma lista pequena de itens do dia não se beneficia de busca/filtro).

### Instagram

Publicação manual, no máximo 3 posts/dia, em formato carrossel. Imagem usada é a foto crua do produto — sem geração automática de arte no MVP. Stories são sempre manuais, feitos a partir do canal privado do Telegram.

Automação via Graph API (Meta) fica em "melhorias futuras" — requer conta Business/Creator vinculada a uma Página do Facebook e aprovação de App Review da Meta para a permissão `instagram_business_content_publish`, processo que pode levar dias/semanas e deve começar em paralelo ao desenvolvimento, não depois.

## Tecnologias

| Camada | Escolha |
|---|---|
| Frontend | Next.js, React, TailwindCSS |
| Backend | Next.js API Routes, Prisma, PostgreSQL |
| Banco | PostgreSQL (Neon, com connection pooler) |
| Hospedagem | Vercel |
| Agendamento | GitHub Actions |
| Imagens | Sharp (otimização/resize, não geração de arte) |
| IA | OpenAI ou OpenRouter (opção mais barata) |
| Notificações | Telegram Bot API |

## Custos

| Serviço | Custo |
|---|---|
| Next.js | Gratuito |
| Vercel | Gratuito |
| PostgreSQL (Neon) | Gratuito |
| Prisma | Gratuito |
| Telegram Bot | Gratuito |
| GitHub Actions | Gratuito |
| Sharp | Gratuito |
| OpenRouter/OpenAI | Baixo custo |

Estimativa: R$0 a R$50/mês.

## Escopo do MVP

**Dentro:**
- Coleta automática (Mercado Livre)
- Cadastro manual (Amazon / Shopee)
- Banco de dados
- IA selecionando e pontuando ofertas
- Telegram (canal privado top 20 + grupo público)
- Site público (lista simples, sem busca/filtro)

**Fora (melhorias futuras):**
- Instagram automático (via Graph API, requer App Review da Meta)
- Stories automáticos
- Busca e filtro no site
- Dashboard administrativo
- Aprovar/rejeitar promoções manualmente antes da publicação
- Histórico de preços / integração com Keepa
- Publicação automática no WhatsApp
- Geração automática de artes (Feed, Stories, Reels)
- IA escrevendo legenda
- Agendamento de publicações
- Estatísticas de cliques e de comissão
- Dashboard financeiro
- Integração automática Amazon/Shopee (quando API estiver liberada) ou via rede agregadora (Lomadee)

## Roadmap

**Semana 1**: estrutura do projeto, banco, Prisma, integração Mercado Livre (automática), cron via GitHub Actions.

**Semana 2**: formulário de cadastro manual (Amazon/Shopee), ajuste de filtros e score para lidar com campos opcionais (`source`, `discount`).

**Semana 3**: IA, Score Bons Achados, ranking das ofertas.

**Semana 4**: Telegram (canal privado + grupo público), logs, site público básico (lista simples).

## Objetivo final (visão de longo prazo)

Marketplace → Coleta → IA → Ranking → Telegram → Instagram → Recebimento das comissões, com intervenção humana limitada a aprovar ou publicar as melhores ofertas.
