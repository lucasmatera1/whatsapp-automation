# 📱 WhatsApp Automation

> Sistema completo de automação para WhatsApp Business API — envio de campanhas, respostas automáticas inteligentes, aquecimento de número, painel administrativo e muito mais.

[![CI](https://github.com/lucasmatera1/whatsapp-automation/actions/workflows/ci.yml/badge.svg)](https://github.com/lucasmatera1/whatsapp-automation/actions/workflows/ci.yml)

---

## 📋 Índice

- [Visão Geral](#-visão-geral)
- [Funcionalidades](#-funcionalidades)
- [Arquitetura](#-arquitetura)
- [Stack Tecnológico](#-stack-tecnológico)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Uso](#-uso)
  - [Servidor de Desenvolvimento](#servidor-de-desenvolvimento)
  - [CLI (Linha de Comando)](#cli-linha-de-comando)
  - [API REST](#api-rest)
  - [Painel Administrativo](#painel-administrativo)
- [Templates](#-templates)
- [Sistema de Aquecimento (Warmup)](#-sistema-de-aquecimento-warmup)
- [Webhook](#-webhook)
- [Motor de Conversa](#-motor-de-conversa)
- [Text-to-Speech (TTS)](#-text-to-speech-tts)
- [Fila de Mensagens](#-fila-de-mensagens)
- [Banco de Dados](#-banco-de-dados)
- [Docker](#-docker)
- [Testes](#-testes)
- [Segurança](#-segurança)
- [Scripts de Diagnóstico](#-scripts-de-diagnóstico)
- [Estrutura de Arquivos](#-estrutura-de-arquivos)

---

## 🎯 Visão Geral

Sistema projetado para gerenciar comunicação via WhatsApp Business API (Meta Cloud API v23.0). Permite envio de campanhas de marketing, mensagens de utilidade, respostas automáticas com inteligência contextual, geração de áudio via TTS e aquecimento progressivo do número para escalar volume de envios com segurança.

**Principais casos de uso:**
- Campanhas de marketing e reativação de clientes
- Notificações transacionais (pedidos, entregas, agendamentos)
- Atendimento automatizado com respostas contextuais
- Pesquisas de satisfação
- Cobranças e lembretes

---

## ✨ Funcionalidades

### Envio de Mensagens
- **Templates aprovados pela Meta** — Marketing, Utilidade e Autenticação
- **Mensagens livres** na janela de 24h após resposta do usuário
- **Envio por tags** — Segmente contatos e envie para grupos específicos
- **Reativação automática** — Detecta clientes inativos e envia campanha
- **Geração de conteúdo variado** — Banco de frases evita repetição ("parecer bot")

### Respostas Automáticas
- **Motor de conversa inteligente** — Detecta intenção, humor e tópico da mensagem
- **Debounce** — Espera 8s para agrupar mensagens rápidas antes de responder
- **Gap mínimo** — 30s entre respostas ao mesmo contato
- **Áudio TTS** — 30% das respostas são enviadas como áudio (voz brasileira)
- **Persona configurável** — Nome do negócio, horários, serviços, diferenciais

### Aquecimento do Número
- **4 fases progressivas** — De 50 a 10.000 msgs/dia
- **Promoção automática** — Detecta quando é seguro subir de fase
- **Monitoramento de qualidade** — Para envios se a qualidade cair
- **Scheduler** — 4 slots diários com templates variados

### Painel Administrativo
- **Dashboard** — Contatos, mensagens, warmup chart, logs em tempo real
- **Chat** — Conversa com contatos, envio de texto e áudio
- **Settings** — Business Profile, QR Codes
- **Autenticação JWT** — Login protegido com token de 24h

### Infraestrutura
- **Fila BullMQ** — Delays humanizados, retry exponencial, prioridade
- **Circuit Breaker** — Proteção contra falhas em cascata na API Meta
- **Opt-out automático** — Detecta e respeita pedidos de descadastro
- **Rate limiting** — 60 req/min por IP
- **Logs completos** — Winston com arquivo, console e SSE em tempo real
- **Docker ready** — Multi-stage build otimizado

---

## 🏗 Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                        Express Server (:3000)               │
├─────────┬────────────┬──────────┬──────────┬───────────────┤
│ Webhook │  REST API  │  Admin   │   CLI    │  SSE (Live)   │
│ (Meta)  │  /api/*    │  Panel   │          │  /api/live    │
└────┬────┴─────┬──────┴────┬─────┴────┬─────┴───────┬───────┘
     │          │           │          │             │
     ▼          ▼           ▼          ▼             ▼
┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐
│Conversa-│ │Warmup  │ │Contact │ │Template│ │  Logger  │
│tion     │ │Manager │ │Manager │ │Library │ │ (Winston)│
│Engine   │ │(4fases)│ │(CRUD)  │ │(15 tpl)│ │          │
└────┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └──────────┘
     │          │          │          │
     ▼          ▼          ▼          ▼
┌──────────────────────────────────────────┐
│           BullMQ Queue (Redis)           │
│  Delays humanizados · Retry · Prioridade │
└────────────────────┬─────────────────────┘
                     ▼
┌──────────────────────────────────────────┐
│     WhatsApp Cloud API Client (Meta)     │
│  Circuit Breaker · v23.0 · HMAC Verify  │
└────────────────────┬─────────────────────┘
                     ▼
┌──────────────────────────────────────────┐
│          SQLite (data.db · WAL)          │
│ contacts · messages · warmup_log · events│
└──────────────────────────────────────────┘
```

---

## 🛠 Stack Tecnológico

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| **Node.js** | 20+ | Runtime |
| **TypeScript** | 5.5+ | Linguagem |
| **Express** | 4.21 | Servidor HTTP |
| **BullMQ** | 5.x | Fila de mensagens |
| **Redis** | 6+ | Backend da fila |
| **SQLite** | via better-sqlite3 | Banco de dados |
| **Winston** | 3.14 | Logging |
| **Zod** | 3.23 | Validação de config |
| **JWT** | jsonwebtoken | Autenticação admin |
| **MsEdge TTS** | 2.x | Text-to-Speech |
| **Jest** | 29.x | Testes |
| **Docker** | Multi-stage | Deploy |

---

## 📦 Instalação

### Pré-requisitos

- **Node.js** 20 ou superior
- **Redis** 6+ rodando (ou via Docker)
- **Conta Meta Business** com WhatsApp Business API configurada
- **ngrok** (para receber webhooks em desenvolvimento)

### Passos

```bash
# 1. Clonar o repositório
git clone https://github.com/lucasmatera1/whatsapp-automation.git
cd whatsapp-automation

# 2. Instalar dependências
npm install

# 3. Copiar e configurar variáveis de ambiente
cp .env.example .env
# Edite o .env com suas credenciais (ver seção Configuração)

# 4. Subir o Redis (se não tiver rodando)
docker run -d --name redis -p 6379:6379 redis:7-alpine

# 5. Rodar em modo desenvolvimento
npm run dev
```

O servidor inicia na porta **3000**.

---

## ⚙ Configuração

Copie o `.env.example` para `.env` e preencha:

```env
# ══════════════════════════════════════════
# WhatsApp Cloud API
# ══════════════════════════════════════════
WHATSAPP_TOKEN=seu_token_permanente        # Token do Meta Business
PHONE_NUMBER_ID=seu_phone_number_id        # ID do número registrado
WABA_ID=seu_waba_id                        # ID da conta WhatsApp Business
VERIFY_TOKEN=seu_token_de_verificacao      # Token customizado para webhook
APP_SECRET=seu_app_secret                  # Para validar assinatura webhook

# ══════════════════════════════════════════
# Servidor
# ══════════════════════════════════════════
PORT=3000
NODE_ENV=development

# ══════════════════════════════════════════
# Redis (fila BullMQ)
# ══════════════════════════════════════════
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# ══════════════════════════════════════════
# Aquecimento
# ══════════════════════════════════════════
WARMUP_PHASE=1                 # Fase atual: 1, 2, 3 ou 4
WARMUP_DAILY_LIMIT=50          # Máximo de mensagens por dia
WARMUP_MIN_INTERVAL=5000       # Intervalo mínimo entre msgs (ms)

# ══════════════════════════════════════════
# Admin Panel
# ══════════════════════════════════════════
ADMIN_USER=admin
ADMIN_PASS=sua_senha_admin
JWT_SECRET=sua_chave_jwt_secreta
```

### Obtendo as Credenciais Meta

1. Acesse [Meta for Developers](https://developers.facebook.com)
2. Crie um App do tipo **Business**
3. Adicione o produto **WhatsApp**
4. Em **API Setup**, copie o **Phone Number ID** e o **Token de acesso permanente**
5. Em **App Settings > Basic**, copie o **App Secret**
6. O **WABA ID** está em **WhatsApp > Getting Started**

---

## 🚀 Uso

### Servidor de Desenvolvimento

```bash
npm run dev          # Inicia com ts-node (hot reload manual)
npm run build        # Compila TypeScript
npm start            # Roda versão compilada (produção)
```

### CLI (Linha de Comando)

```bash
# Ver status do warmup e qualidade
npm run send -- status

# Enviar template para um número
npm run send -- send <template_name> <phone> [param1] [param2]

# Enviar template para todos de uma tag
npm run send -- send-tag <tag> <template_name>

# Reativar clientes inativos (últimos N dias)
npm run send -- reactivate <days> <template_name>

# Importar contatos de CSV
npm run send -- import <arquivo.csv>

# Ver estatísticas
npm run send -- stats [template_name]

# Listar templates aprovados na Meta
npm run send -- templates

# Listar templates locais
npm run send -- templates-local

# Submeter template para aprovação
npm run send -- submit-template <key>

# Submeter todos os templates
npm run send -- submit-all

# Verificar promoção de fase
npm run send -- check-phase
```

### API REST

Todas as rotas `/api/*` têm rate limit de 60 req/min por IP.

#### Saúde e Status
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | Health check (DB + Redis) |
| `GET` | `/api/status` | Relatório warmup + quality rating |
| `GET` | `/api/warmup/check` | Verificar promoção de fase |

#### Envio de Mensagens
| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/send/template` | Enviar template para lista de contatos |
| `POST` | `/api/send/by-tag` | Enviar para contatos por tag |
| `POST` | `/api/send/reactivation` | Reativar contatos inativos |
| `POST` | `/api/warmup/fire` | Disparo de aquecimento por tag/dia |

#### Contatos
| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/contacts/import` | Importar CSV (phone, name, tags) |
| `GET` | `/api/stats` | Estatísticas de campanha |

#### Templates
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/templates` | Listar templates Meta |
| `GET` | `/api/templates/local` | Listar templates locais |
| `POST` | `/api/templates/submit` | Submeter 1 template |
| `POST` | `/api/templates/submit-all` | Submeter todos |

#### Live Feed
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/live` | SSE — eventos em tempo real |
| `GET` | `/api/messages/recent` | Últimas 50 mensagens |
| `GET` | `/api/webhook-events/recent` | Últimos 50 eventos webhook |

#### Webhook Meta
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/webhook` | Verificação do webhook (challenge) |
| `POST` | `/webhook` | Receber eventos da Meta |

### Painel Administrativo

Acesse em `http://localhost:3000/panel` (login com `ADMIN_USER` / `ADMIN_PASS`).

| Página | URL | Descrição |
|--------|-----|-----------|
| **Dashboard** | `/panel` | Visão geral: contatos, msgs, warmup chart, logs |
| **Chat** | `/panel/chat` | Conversa com contatos, envio de texto e áudio |
| **Settings** | `/panel/settings` | Business Profile, QR Codes |

**APIs do painel** (protegidas por JWT):

- `POST /panel/api/auth/login` — Autenticação
- `GET /panel/api/dashboard-stats` — Dados do dashboard
- `GET /panel/api/contacts` — Contatos (paginação + busca)
- `GET /panel/api/messages` — Mensagens (paginação + filtro)
- `POST /panel/api/send/text` — Enviar texto
- `POST /panel/api/send/audio` — Enviar áudio TTS
- `GET /panel/api/warmup-history` — Histórico warmup (30 dias)
- `GET /panel/api/app-logs` — Logs da aplicação
- `GET /panel/api/log-stream` — SSE logs tempo real
- `GET /panel/api/live-feed` — SSE eventos ao vivo

---

## 📝 Templates

O sistema inclui uma biblioteca de **15 templates locais** prontos para submeter à Meta.

### Marketing (4)

| Template | Descrição |
|----------|-----------|
| `reativacao_cliente` | Reativação com oferta especial |
| `promocao_geral` | Promoção com validade |
| `boas_vindas_marketing` | Boas-vindas com cupom |
| `aviso_funcionamento` | Aviso de horário de atendimento |

### Utilidade (9)

| Template | Descrição |
|----------|-----------|
| `notificacao_novidade` | Novidade ou atualização |
| `confirmacao_pedido` | Confirmação de pedido |
| `lembrete_agendamento` | Lembrete com data/hora/local |
| `atualizacao_entrega` | Status de entrega |
| `cobranca_lembrete` | Lembrete de pagamento pendente |
| `pesquisa_satisfacao` | Pesquisa de 1 a 5 |
| `lembrete_retorno` | Lembrete geral |
| `agradecimento_contato` | Agradecimento ao contato |
| `hello_world` | Template padrão Meta |

### Autenticação (1)

| Template | Descrição |
|----------|-----------|
| `codigo_verificacao` | Código OTP com botão "Copiar" |

> **Importante:** Templates de Marketing devem incluir opt-out ("Responda PARAR para cancelar"). Todos os templates locais já seguem essa regra.

---

## 🔥 Sistema de Aquecimento (Warmup)

Números novos da WhatsApp Business API precisam construir reputação gradualmente. O sistema gerencia isso automaticamente.

### Fases

| Fase | Limite/dia | Delay entre msgs | Promoção para próxima fase |
|------|-----------|-------------------|---------------------------|
| **1** | 50 | ~15s | 7 dias com ≥70% do limite (35 msgs) + Quality GREEN |
| **2** | 200 | ~10s | 7 dias com ≥70% do limite (140 msgs) + Quality GREEN |
| **3** | 1.000 | ~7s | Volume consistente + Quality GREEN |
| **4** | 10.000 | ~4s | Fase máxima |

### Monitoramento de Qualidade

- **GREEN** — Envio normal
- **YELLOW** — Limite reduzido a 50%
- **RED** — Todos os envios bloqueados

### Scheduler Automático

4 disparos diários em horários estratégicos:

| Horário | Template | Objetivo |
|---------|----------|----------|
| 09:00 | `notificacao_novidade` | Novidade do dia |
| 11:30 | `pesquisa_satisfacao` | Engajamento |
| 14:30 | `lembrete_retorno` | Lembrete |
| 17:00 | `agradecimento_contato` | Agradecimento |

O scheduler verifica Quality Rating antes de cada batch e respeita limites diários e opt-outs.

---

## 🔗 Webhook

O webhook recebe eventos da Meta em tempo real.

### Configuração

1. Inicie o servidor (`npm run dev`)
2. Inicie o ngrok: `ngrok http 3000`
3. No [Meta Dashboard](https://developers.facebook.com), configure:
   - **Callback URL**: `https://seu-ngrok-url.ngrok.io/webhook`
   - **Verify Token**: o mesmo do `.env`
   - **Campos**: `messages`, `message_deliveries`, `message_reads`

### Fluxo de Eventos

```
Meta → POST /webhook
         │
         ├── Status Update (sent/delivered/read/failed)
         │   └── Atualiza tabela messages
         │
         └── Mensagem Recebida
             ├── Mark as Read (✓✓ azul)
             ├── Upsert contato
             ├── Detectar opt-out → marcar contato
             ├── Acumular no debounce (8s)
             └── Gerar resposta (texto 70% / áudio 30%)
```

### Validação de Segurança

Toda requisição do webhook é validada via **HMAC SHA-256** usando o `APP_SECRET`, garantindo que veio da Meta.

---

## 🧠 Motor de Conversa

O `conversation-engine.ts` gera respostas contextuais inteligentes.

### Detecção de Intenção

Reconhece automaticamente:
- **Saudações**: oi, olá, bom dia, boa tarde...
- **Despedida**: tchau, até mais, fui...
- **Agradecimento**: obrigado, valeu, thanks...
- **Perguntas**: preço, serviço, horário, localização
- **Interesse**: quero, tenho interesse, sim...
- **Reclamação**: problema, insatisfeito, péssimo...
- **Elogio**: excelente, parabéns, ótimo...

### Contexto de Conversa

- Mantém histórico de até **12 mensagens por contato**
- Contexto expira após **4 horas** sem interação
- Detecta humor (positivo/neutro/negativo) por palavras-chave e emojis
- Identifica tópicos: tela, bateria, acessórios, preço, prazo, garantia, modelo

### Respostas Variadas

Cada intenção tem múltiplas respostas possíveis, selecionadas aleatoriamente para soar natural.

---

## 🔊 Text-to-Speech (TTS)

Gera áudios com vozes brasileiras naturais usando Microsoft Edge TTS.

| Voz | Tipo | Probabilidade |
|-----|------|---------------|
| `pt-BR-ThalitaNeural` | Feminina | 50% |
| `pt-BR-AntonioNeural` | Masculina | 50% |

### Características

- **Prosódia aleatória**: variação de velocidade (±8-12%), tom (±4-6Hz) e volume (±5%)
- **Formato**: MP3 24kHz 48kbps mono
- **Timeout**: 20s
- **Preparação**: remove emojis e limpa espaços antes de gerar áudio

---

## 📬 Fila de Mensagens

O BullMQ gerencia o envio com comportamento humanizado.

### Delays Humanizados

- **Base**: 8-25 segundos entre mensagens
- **Jitter gaussiano**: ±20% de variação
- **Fadiga**: +5% a cada 10 mensagens
- **Pausa longa**: 12% de chance de pausa extra
- **Micro-delay**: 2-6s antes de cada envio individual

### Prioridades

| Categoria | Prioridade | Descrição |
|-----------|-----------|-----------|
| Authentication | 0 (alta) | Códigos de verificação |
| Utility | 1 (média) | Pedidos, entregas, lembretes |
| Marketing | 2 (baixa) | Promoções, reativações |

### Resiliência

- **3 tentativas** por mensagem
- **Backoff exponencial** (30s base)
- Verificação de limite diário antes de cada envio

---

## 💾 Banco de Dados

SQLite com WAL mode para performance concorrente.

### Tabelas

#### `contacts`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | INTEGER PK | Auto increment |
| `phone` | TEXT UNIQUE | Número no formato 55DDDNNNNNNNNN |
| `name` | TEXT | Nome do contato |
| `tags` | TEXT | Tags separadas (ex: 'fase1') |
| `opted_in` | INTEGER | Se aceitou receber msgs |
| `opted_out` | INTEGER | Se pediu para sair |
| `created_at` | TEXT | Data de criação |

#### `messages`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | INTEGER PK | Auto increment |
| `wamid` | TEXT UNIQUE | WhatsApp Message ID |
| `contact_phone` | TEXT | Telefone do contato |
| `template_name` | TEXT | Nome do template usado |
| `body` | TEXT | Corpo da mensagem |
| `category` | TEXT | marketing / utility / authentication |
| `status` | TEXT | queued → sent → delivered → read / failed |
| `sent_at` | TEXT | Quando foi enviada |

#### `warmup_log`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `date` | TEXT | Data (YYYY-MM-DD) |
| `messages_sent` | INTEGER | Total enviado no dia |
| `phase` | INTEGER | Fase ativa |
| `quality_rating` | TEXT | GREEN / YELLOW / RED |

#### `webhook_events`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `event_type` | TEXT | incoming_message, status_sent, etc. |
| `payload` | TEXT | JSON do evento |
| `processed` | INTEGER | Se já foi processado |

---

## 🐳 Docker

### Build e execução rápida

```bash
# Subir tudo (app + Redis)
docker compose up -d

# Apenas build
docker build -t whatsapp-automation .

# Ver logs
docker compose logs -f app
```

### Características do Docker

- **Multi-stage build** — Imagem final leve (node:20-alpine)
- **Usuário não-root** — Roda como `appuser` (UID 1001)
- **Healthcheck** — Verifica `/health` a cada 30s
- **Volumes persistentes** — Logs e dados do SQLite

---

## 🧪 Testes

```bash
npm test                  # Rodar todos os testes
npm run test:watch        # Modo watch
npm run test:coverage     # Com cobertura de código
```

### Suites de Teste

| Arquivo | O que testa |
|---------|-------------|
| `circuit-breaker.test.ts` | Circuit breaker (open/close/half-open) |
| `contacts.test.ts` | Validação e limpeza de telefones brasileiros |
| `templates.test.ts` | Biblioteca de templates (estrutura, footer, opt-out) |
| `warmup.test.ts` | Gerenciamento de fases e limites |
| `webhook.test.ts` | Rotas de webhook (GET verify + POST events) |

### CI/CD

O GitHub Actions roda automaticamente a cada push:

1. **Lint** (ESLint) — Node 20 e 22
2. **Testes** (Jest) — Node 20 e 22
3. **Build** (TypeScript)
4. **Docker Build** (apenas na branch main)

---

## 🔒 Segurança

| Proteção | Implementação |
|----------|---------------|
| **Webhook HMAC** | Validação SHA-256 com `APP_SECRET` |
| **Autenticação JWT** | Painel admin com token de 24h |
| **Rate Limiting** | 60 req/min por IP nas rotas `/api` |
| **Circuit Breaker** | 5 falhas → bloqueio de 60s na API Meta |
| **Opt-out** | 5 regex patterns detectam pedidos de descadastro |
| **Variáveis sensíveis** | Todas em `.env` (nunca no código) |
| **Docker non-root** | Container roda como usuário sem privilégios |
| **Validação Zod** | Schema de configuração validado na inicialização |

### Padrões de Opt-out Detectados

O sistema reconhece automaticamente:
- "me tira" / "sair da lista" / "não quero mais"
- "descadastrar" / "para de mandar"
- Botão "Não" em templates com Quick Reply
- Resposta "PARAR" no footer de marketing

---

## 🔧 Scripts de Diagnóstico

Scripts auxiliares na raiz do projeto para verificação rápida:

| Script | Uso |
|--------|-----|
| `check-status.js` | Visão geral: contatos, msgs, warmup, quality |
| `check-allies.js` | Lista aliados com stats de msgs |
| `check-incoming.js` | Mensagens recebidas + health check |
| `check-feedback.js` | Status dos disparos (sent/delivered/read) |
| `check-responses.js` | Respostas recebidas por contato |
| `check-elo.js` | Verificação de elo/engajamento |
| `check-scheduler.js` | Status do scheduler |
| `add-allies.js` | Inserir novos aliados no banco |
| `add-ally.js` | Inserir um aliado individual |

---

## 📁 Estrutura de Arquivos

```
whatsapp-automation/
├── src/
│   ├── index.ts                 # Entry point, Express, rotas REST, SSE
│   ├── config.ts                # Schema Zod para variáveis de ambiente
│   ├── whatsapp-api.ts          # Client Meta Graph API v23.0 + Circuit Breaker
│   ├── webhook.ts               # Handler de webhook (POST/GET) + auto-reply
│   ├── database.ts              # SQLite init, schema DDL
│   ├── queue.ts                 # BullMQ fila + worker com delays humanizados
│   ├── warmup.ts                # WarmupManager (fases, limites, cron)
│   ├── contacts.ts              # CRUD contatos, import CSV, stats
│   ├── templates.ts             # Biblioteca de 15 templates + submit Meta
│   ├── conversation-engine.ts   # Motor de conversa (intents, humor, tópicos)
│   ├── content-generator.ts     # Variação de conteúdo (PHRASE_BANK)
│   ├── admin-panel.ts           # Painel admin (JWT, dashboard, chat, settings)
│   ├── cli.ts                   # CLI: status, send, import, stats
│   ├── logger.ts                # Winston + MemoryTransport + SSE
│   ├── tts.ts                   # MsEdge TTS wrapper (vozes pt-BR)
│   └── scheduler.ts             # Scheduler de disparos automáticos
├── tests/
│   ├── circuit-breaker.test.ts
│   ├── contacts.test.ts
│   ├── templates.test.ts
│   ├── warmup.test.ts
│   └── webhook.test.ts
├── .github/workflows/
│   └── ci.yml                   # GitHub Actions CI pipeline
├── .env.example                 # Template de variáveis de ambiente
├── .gitignore
├── Dockerfile                   # Multi-stage build (node:20-alpine)
├── docker-compose.yml           # App + Redis
├── package.json
├── tsconfig.json
├── jest.config.ts
├── eslint.config.mjs
└── contatos-exemplo.csv         # Exemplo de CSV para importação
```

---

## 📄 Licença

Projeto privado. Todos os direitos reservados.
