# Bons Achados - MVP

## Objetivo

Criar uma plataforma que automatiza a coleta de promoções (Mercado Livre) e recebe promoções cadastradas manualmente (Amazon/Shopee), utiliza IA para selecionar apenas as melhores ofertas e envia automaticamente para o Telegram — canal privado (top 20, para uso pessoal na criação de Stories) e grupo público (todas as aprovadas) — para publicação manual de até 3 posts/dia em carrossel no Instagram.

---

# Fluxo

```text
Mercado Livre (coleta automática)
Amazon / Shopee (cadastro manual)
      │
      ▼
PostgreSQL
      │
      ▼
Filtros Automáticos
      │
      ▼
IA avalia as promoções
      │
      ▼
Ranking das melhores ofertas
      │
      ▼
Telegram
  ├─ Canal privado (top 20) → uso pessoal para montar Stories
  └─ Grupo público (todas aprovadas) → outras pessoas
      │
      ▼
Publicação manual no Instagram (até 3 posts/dia + Stories manuais)
```

---

# Tecnologias

## Frontend

- Next.js
- React
- TailwindCSS

## Backend

- Next.js API Routes
- Prisma
- PostgreSQL

## Banco

- PostgreSQL (Neon)

## Hospedagem

- Vercel

## Agendamento

- GitHub Actions
ou
- Vercel Cron

## Imagens

- Sharp

## IA

- OpenAI
- OpenRouter (opção mais barata)

## Notificações

- Telegram Bot API

---

# Estrutura do Banco

## Products

```sql
id
marketplace
source        -- auto | manual
productId
title
description
price
oldPrice      -- opcional (nem sempre disponível na Amazon/Shopee)
discount      -- opcional
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

---

# Marketplace

## Mercado Livre — coleta automática

API oficial de afiliados. Único marketplace com integração automatizada no MVP.

Coletar

- Produto
- Imagem
- Link
- Preço
- Categoria
- Avaliações

Gerar link de afiliado automaticamente.

---

## Amazon — cadastro manual

PA-API exige 10 vendas qualificadas nos últimos 30 dias para liberar acesso pleno — inviável no início. Produtos são adicionados manualmente por formulário/bot, já com curadoria humana.

Cadastrar

- Nome
- Preço
- Preço anterior (opcional, se visível na página)
- Imagem
- Link
- Avaliação
- Categoria

Adicionar automaticamente

- Tag de afiliado

---

## Shopee — cadastro manual

API de afiliados exige aprovação manual (até 2 semanas). Produtos são adicionados manualmente por formulário/bot, já com curadoria humana.

Cadastrar

- Produto
- Imagem
- Comissão
- Cupom
- Link
- Preço anterior (opcional, se visível na página)

---

> Amazon e Shopee entram como integração automática em "Melhorias futuras", quando já houver volume de vendas (Amazon) ou aprovação de API (Shopee) — ou via rede agregadora (ex.: Lomadee).

---

# Pipeline

## 1 - Coleta

Executar a cada 10 minutos.

Salvar todos os produtos encontrados.

---

## 2 - Filtros

Eliminar produtos ruins.

Regras para produtos automáticos (`source = auto`, Mercado Livre):

- desconto menor que 25%
- menos de 100 avaliações
- nota inferior a 4.5
- sem estoque

Produtos manuais (`source = manual`, Amazon/Shopee) pulam a regra de desconto mínimo — já passaram por curadoria humana antes do cadastro. As demais regras (avaliações, nota, estoque) continuam valendo.

Exemplo:

```
500 produtos

↓

42 produtos válidos
```

---

## 3 - IA

A IA recebe apenas os produtos filtrados.

Ela analisa:

- desconto (quando disponível)
- preço
- categoria
- avaliações
- comissão
- confiabilidade
- histórico de preço (futuro)

Quando `discount`/`oldPrice` não estiverem preenchidos (comum em cadastros manuais de Amazon/Shopee), a IA pontua com os demais critérios — a ausência do campo não zera nem penaliza o score, só deixa de somar os pontos de "desconto excelente".

Resultado:

```text
Produto

Echo Dot

Score: 98

Motivo

✔ desconto excelente
✔ muitas avaliações
✔ preço abaixo da média
✔ produto muito vendido
```

---

# Score Bons Achados

Criar um score próprio.

Exemplo

```
98/100

★★★★★

✔ Desconto real

✔ Excelente avaliação

✔ Frete grátis

✔ Produto confiável
```

Esse score será um diferencial da página.

---

# Telegram

Dois destinos, com propósitos diferentes:

## Canal/grupo privado (uso pessoal)

Todos os dias enviar automaticamente as **20 melhores promoções** (ranking por score).

Uso: base para eu montar os **Stories manualmente** (pego a imagem e o link de cada uma) e escolher as **até 3** que viram post em carrossel no Instagram.

## Grupo público (outras pessoas)

Enviar automaticamente **todas as promoções aprovadas no filtro** (não só o top 20), sem curadoria adicional — volume bruto pós-filtro para quem quiser acompanhar todas as ofertas.

Exemplo

```
🔥 Echo Dot 5ª Geração

💰 R$219

De R$399

45% OFF

★★★★★

24.000 avaliações

🔗 Link de afiliado

📷 Imagem do produto
```

Cada mensagem deve conter:

- imagem
- preço
- desconto
- link
- marketplace
- score Bons Achados

---

# MVP

Primeira versão

✅ Coleta automática (Mercado Livre)

✅ Cadastro manual (Amazon / Shopee)

✅ Banco de dados

✅ IA selecionando ofertas

✅ Telegram (canal privado top 20 + grupo público)

❌ Instagram automático (publicação manual, até 3 posts/dia em carrossel)

❌ Stories automáticos (sempre manuais, feitos a partir do canal privado)

---

# Custos

| Serviço | Custo |
|----------|--------|
| Next.js | Gratuito |
| Vercel | Gratuito |
| PostgreSQL (Neon) | Gratuito |
| Prisma | Gratuito |
| Telegram Bot | Gratuito |
| GitHub Actions | Gratuito |
| Sharp | Gratuito |
| OpenRouter/OpenAI | Baixo custo |

Estimativa:

R$0 a R$50/mês.

---

# Roadmap

## Semana 1

- Estrutura do projeto
- Banco
- Prisma
- Integração Mercado Livre (automática)
- Cron Jobs

---

## Semana 2

- Formulário/bot de cadastro manual (Amazon / Shopee)
- Ajustar filtros e score para lidar com campos opcionais (`source`, `discount`)

---

## Semana 3

- IA
- Score Bons Achados
- Ranking das ofertas

---

## Semana 4

- Telegram Bot (canal privado top 20 + grupo público)
- Envio automático
- Logs
- Dashboard básico

---

# Melhorias futuras

- Dashboard administrativo

- Aprovar/Rejeitar promoções

- Histórico de preços

- Integração com Keepa

- Publicação automática no Instagram (via Graph API — requer App Review da Meta para produção)

- Publicação automática no Canal WhatsApp

- Publicação automática no Telegram

- Geração automática de artes (Feed)

- Geração automática de Stories

- Geração automática de Reels

- IA escrevendo legenda

- Agendamento de publicações

- Estatísticas de cliques

- Estatísticas de comissão

- Dashboard financeiro

---

# Objetivo Final

Criar uma plataforma onde todo o processo seja automatizado:

Marketplace

↓

Coleta

↓

IA

↓

Ranking

↓

Telegram

↓

Instagram

↓

Recebimento das comissões

Intervenção humana apenas para aprovar ou publicar as melhores ofertas.