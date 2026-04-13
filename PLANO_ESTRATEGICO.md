# Plano Estratégico - Reino - Avisos | WhatsApp Business API

> **Última atualização**: 06/04/2026 (23h)
> **Status geral**: 🟢 Sistema OPERACIONAL — Painel admin, IA conversacional, TTS áudio, logs humanizados. Aquecimento Fase 1 iniciado (2/50 do dia). 14 templates submetidos, 2 aprovados, 12 pendentes.

---

## ÍNDICE

1. [Por que usar a API oficial da Meta](#1-por-que-usar-a-api-oficial-da-meta)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Estratégia de Aquecimento](#3-estratégia-de-aquecimento-do-chip-warm-up)
4. [Templates de Mensagem](#4-templates-de-mensagem-obrigatório)
5. [Gestão de Qualidade](#5-gestão-de-qualidade-anti-ban)
6. [Custos](#6-custos-modelo-conversation-based-pricing)
7. [Arquitetura Técnica](#7-arquitetura-técnica)
8. [**PROGRESSO DO DESENVOLVIMENTO**](#8-progresso-do-desenvolvimento)
9. [**ESTRUTURA DE ARQUIVOS**](#9-estrutura-de-arquivos)
10. [**ENDPOINTS DA API REST**](#10-endpoints-da-api-rest)
11. [**GUIA DE INTEGRAÇÃO COM APP PRINCIPAL**](#11-guia-de-integração-com-app-principal)
12. [**PRÓXIMOS PASSOS**](#12-próximos-passos)

---

## 1. POR QUE USAR A API OFICIAL DA META

| Método | Risco de Ban | Escalabilidade | Legalidade |
|--------|-------------|----------------|------------|
| WhatsApp Web + Selenium/Puppeteer | 🔴 Altíssimo | Baixa | Viola ToS |
| Bibliotecas não-oficiais (Baileys, Venom, etc.) | 🔴 Alto | Média | Viola ToS |
| **WhatsApp Cloud API (Meta)** | 🟢 Zero* | Alta | ✅ Oficial |

> *Zero risco de ban desde que siga as políticas de qualidade da Meta.

---

## 2. PRÉ-REQUISITOS

### 2.1 Conta Meta Business
1. Criar conta no [Meta Business Suite](https://business.facebook.com)
2. Verificar o negócio (CNPJ ou equivalente)
3. Acessar o [Meta for Developers](https://developers.facebook.com)
4. Criar um App do tipo "Business"
5. Adicionar o produto "WhatsApp" ao app

### 2.2 Número de Telefone
- Usar um chip NOVO dedicado exclusivamente para a API
- O número NÃO pode estar registrado no WhatsApp normal
- Registrar o número via API da Meta (processo guiado no painel)

### 2.3 Tokens e Credenciais
- `WHATSAPP_TOKEN` - Token de acesso permanente
- `PHONE_NUMBER_ID` - ID do número registrado
- `WABA_ID` - ID da conta WhatsApp Business
- `VERIFY_TOKEN` - Token para webhook (você define)

---

## 3. ESTRATÉGIA DE AQUECIMENTO DO CHIP (WARM-UP)

### Semana 1 - Fase Inicial
- Máximo **50 mensagens/dia**
- Apenas mensagens de **utilidade** (confirmações, boas-vindas)
- Enviar para contatos que já interagiram com o negócio
- Manter taxa de resposta > 30%

### Semana 2 - Expansão Leve
- Máximo **200 mensagens/dia**
- Introduzir mensagens de **marketing leve**
- Monitorar Quality Rating no painel Meta
- Se Quality Rating cair para YELLOW, reduzir volume 50%

### Semana 3 - Expansão Moderada
- Máximo **1.000 mensagens/dia**
- Diversificar tipos de template (marketing + utilidade)
- Manter intervalo mínimo de 3-5 segundos entre envios

### Semana 4+ - Escala Total
- Até **100.000 mensagens/dia** (limite da API)
- A Meta aumenta os tiers automaticamente:
  - Tier 1: 1.000 contatos únicos/24h
  - Tier 2: 10.000 contatos únicos/24h
  - Tier 3: 100.000 contatos únicos/24h
  - Tier 4: Ilimitado

### Regras de Ouro do Aquecimento
1. **NUNCA pule tiers** - respeite o limite de cada fase
2. **Quality Rating GREEN** é obrigatório para subir de tier
3. Se receber status **FLAGGED**, pause imediatamente por 24-48h
4. Mantenha taxa de bloqueio < 2% (usuários que bloqueiam seu número)

---

## 4. TEMPLATES DE MENSAGEM (Obrigatório)

A Meta exige que toda mensagem iniciada pelo negócio use um **template aprovado**.

### 4.1 Categorias de Template
| Categoria | Uso | Custo |
|-----------|-----|-------|
| **Utility** | Confirmações, atualizações, alertas | Mais barato |
| **Marketing** | Promoções, reativação, ofertas | Mais caro |
| **Authentication** | Códigos OTP, verificação | Mais barato |

### 4.2 Exemplos de Templates

**Reativação (Marketing):**
```
Olá {{1}}! 👋 Sentimos sua falta! 
Temos uma oferta especial para você: {{2}}
Responda SIM para saber mais ou PARAR para não receber mais mensagens.
```

**Confirmação de Pedido (Utility):**
```
✅ Pedido {{1}} confirmado!
Valor: R$ {{2}}
Previsão de entrega: {{3}}
Acompanhe pelo link: {{4}}
```

**Lembrete (Utility):**
```
Olá {{1}}, lembrete do seu agendamento:
📅 Data: {{2}}
⏰ Horário: {{3}}
📍 Local: {{4}}
Confirme respondendo SIM ou reagende respondendo REAGENDAR.
```

### 4.3 Status dos Templates (06/04/2026)

| Template | Categoria | Status |
|----------|-----------|--------|
| `hello_world` | UTILITY | ✅ APPROVED |
| `codigo_verificacao` | AUTHENTICATION | ✅ APPROVED |
| `reativacao_cliente` | MARKETING | ⏳ PENDING |
| `promocao_geral` | MARKETING | ⏳ PENDING |
| `boas_vindas_marketing` | MARKETING | ⏳ PENDING |
| `confirmacao_pedido` | UTILITY | ⏳ PENDING |
| `lembrete_agendamento` | UTILITY | ⏳ PENDING |
| `atualizacao_entrega` | UTILITY | ⏳ PENDING |
| `cobranca_lembrete` | UTILITY | ⏳ PENDING |
| `aviso_funcionamento` | MARKETING | ⏳ PENDING |
| `pesquisa_satisfacao` | UTILITY | ⏳ PENDING |
| `notificacao_novidade` | UTILITY | ⏳ PENDING |
| `lembrete_retorno` | UTILITY | ⏳ PENDING |
| `agradecimento_contato` | UTILITY | ⏳ PENDING |
| `confirmacao_cadastro` | UTILITY | ❌ REJECTED (variáveis inválidas) |

### 4.4 Regras para Aprovação de Templates
- Sem linguagem agressiva de vendas
- Sempre incluir opção de opt-out
- Sem conteúdo enganoso
- Variáveis ({{1}}, {{2}}) não podem ser o conteúdo principal
- Aprovação leva de 1 minuto a 24 horas

---

## 5. GESTÃO DE QUALIDADE (Anti-Ban)

### Métricas Críticas para Monitorar
1. **Quality Rating**: GREEN → YELLOW → RED → BANNED
2. **Phone Number Status**: CONNECTED → FLAGGED → RESTRICTED
3. **Message Template Quality**: Active → Paused → Disabled

### O que causa queda de qualidade:
- Muitos usuários clicando "Bloquear" ou "Reportar"
- Enviar para números inválidos (bounce rate alto)
- Conteúdo de template inconsistente com uso real
- Volume muito alto muito rápido

### Boas Práticas
1. **Segmentar lista**: só envie para quem tem relação com seu negócio
2. **Opt-in obrigatório**: colete consentimento antes de enviar
3. **Horário adequado**: envie entre 9h-20h no fuso do destinatário
4. **Frequência**: máximo 2-3 mensagens/semana para marketing
5. **Opt-out fácil**: sempre permita o descadastro
6. **Lista limpa**: valide números antes de enviar (API de verificação)

---

## 6. CUSTOS (Modelo Conversation-Based Pricing)

A Meta cobra por **conversação de 24h** (não por mensagem individual).

| Categoria | Custo (BR, aproximado) |
|-----------|----------------------|
| Marketing | ~R$ 0,40/conversa |
| Utility | ~R$ 0,15/conversa |
| Authentication | ~R$ 0,15/conversa |
| Service (usuário inicia) | Grátis (1.000/mês) |

> Valores podem variar. Consulte: https://developers.facebook.com/docs/whatsapp/pricing

---

## 7. ARQUITETURA TÉCNICA

```
┌─────────────────────────────────────────────┐
│              Seu Servidor Node.js            │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Warm-up  │  │ Disparo  │  │ Webhook   │  │
│  │ Manager  │  │ Engine   │  │ Handler   │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │              │              │        │
│  ┌────┴──────────────┴──────────────┴─────┐  │
│  │           WhatsApp Cloud API           │  │
│  │         (graph.facebook.com)           │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Queue    │  │ Database │  │ Dashboard  │  │
│  │ (Bull)   │  │ (SQLite) │  │ (API/Web)  │  │
│  └──────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────┘
```

### Stack Escolhida
- **Runtime**: Node.js 22.22.2 com TypeScript 5.5+
- **Queue**: BullMQ (Redis) para controle de rate limiting + delays humanizados
- **Database**: SQLite (better-sqlite3) para logs, contatos e mensagens
- **HTTP**: Axios para chamadas à API Meta + Circuit Breaker
- **Webhook**: Express.js para receber eventos (status, mensagens)
- **TTS**: msedge-tts (neural voices pt-BR: Thalita / Antonio)
- **IA**: Conversation Engine (memória, intenções, tópicos, mood, state machine)
- **Admin**: Painel web completo com JWT auth em `/panel`
- **Logs**: Winston + MemoryTransport + SSE stream em tempo real
- **Scheduler**: node-cron para aquecimento automático
- **Testes**: Jest + ts-jest + Supertest (5 suites, 34 testes)
- **CI/CD**: GitHub Actions (lint → test → build → docker)
- **Container**: Docker multi-stage + docker-compose (app + Redis)

---

## 8. PROGRESSO DO DESENVOLVIMENTO

> Atualizado em: **06/04/2026 23h**

| # | Módulo | Arquivo | Status |
|---|--------|---------|--------|
| 1 | Configuração & Validação (Zod) | `src/config.ts` | ✅ Pronto |
| 2 | Logger (Winston + MemoryTransport + SSE) | `src/logger.ts` | ✅ Pronto |
| 3 | Banco de Dados SQLite (localtime) | `src/database.ts` | ✅ Pronto |
| 4 | WhatsApp Cloud API + Circuit Breaker | `src/whatsapp-api.ts` | ✅ Pronto |
| 5 | Warm-up Manager (fases 1-4) | `src/warmup.ts` | ✅ Pronto |
| 6 | Fila de Mensagens (BullMQ + delays humanizados) | `src/queue.ts` | ✅ Pronto |
| 7 | Webhook Handler + Auto-Reply tracking | `src/webhook.ts` | ✅ Pronto |
| 8 | Contatos & Validação Phone (regex BR) | `src/contacts.ts` | ✅ Pronto |
| 9 | Biblioteca de Templates (14 templates) | `src/templates.ts` | ✅ Pronto |
| 10 | Servidor REST + Health + Rate Limit + Graceful Shutdown | `src/index.ts` | ✅ Pronto |
| 11 | CLI de Comandos (fila BullMQ) | `src/cli.ts` | ✅ Pronto |
| 12 | Gerador de Conteúdo Dinâmico | `src/content-generator.ts` | ✅ Pronto |
| 13 | TTS Neural (vozes pt-BR: Thalita/Antonio) | `src/tts.ts` | ✅ Pronto |
| 14 | Conversation Engine (memória, intenções, mood) | `src/conversation-engine.ts` | ✅ Pronto |
| 15 | Painel Admin (JWT auth, dashboard, logs, envio) | `src/admin-panel.ts` | ✅ Pronto |
| 16 | Arquivo de Testes REST | `api.http` | ✅ Pronto |
| 17 | ESLint config | `eslint.config.mjs` | ✅ Pronto |
| 18 | Testes unitários (Jest: 5 suites, 34 testes) | `tests/*.test.ts` | ✅ Pronto |
| 19 | CI/CD (GitHub Actions) | `.github/workflows/ci.yml` | ✅ Pronto |
| 20 | Docker + docker-compose | `Dockerfile`, `docker-compose.yml` | ✅ Pronto |
| 21 | Conta Meta Business verificada | Painel Meta | ✅ Pronto |
| 22 | Registro do número (5544988163024) | Painel Meta | ✅ Pronto |
| 23 | Credenciais no `.env` | `.env` | ✅ Pronto |
| 24 | Redis local (porta 6379) | Redis 5.0.14 | ✅ Pronto |
| 25 | Servidor rodando + health check | `localhost:3000` | ✅ Pronto |
| 26 | Templates submetidos (14 total) | API Meta | ✅ Pronto |
| 27 | Webhook público (ngrok) | `unsneaky-breathily-maryjane.ngrok-free.dev` | ✅ Pronto |
| 28 | Webhook registrado na Meta | Painel Meta | ✅ Pronto |
| 29 | Webhook testado com envio real (hello_world) | Webhooks funcionando | ✅ Pronto |
| 30 | TTS áudio testado (envio manual p/ contatos) | msedge-tts → WhatsApp | ✅ Pronto |
| 31 | Auto-responder com IA conversacional | conversation-engine | ✅ Pronto |
| 32 | Logs humanizados (sem JSON/código bruto) | admin-panel.ts | ✅ Pronto |
| 33 | Timestamps corrigidos (UTC → localtime BR) | Todos os módulos | ✅ Pronto |
| 34 | Auto-replies salvas na tabela messages | webhook.ts | ✅ Pronto |
| 35 | Aprovação dos 12 templates pendentes | Meta review | ⏳ Aguardando |
| 36 | Aquecimento Fase 1 completa (7 dias, 50/dia) | warmup | 🔄 Em andamento |
| 37 | Integração com App Principal | Ver seção 11 | ⬜ Pendente |

---

## 9. ESTRUTURA DE ARQUIVOS

```
whatsapp-automation/
├── .env                    # Variáveis de ambiente (credenciais Meta, Redis, etc.)
├── .env.example            # Template das variáveis
├── .gitignore
├── .dockerignore
├── api.http                # Testes REST Client (extensão VS Code)
├── aliados.csv             # 7 contatos reais para aquecimento fase1
├── contatos-exemplo.csv    # Contatos de exemplo/teste
├── Dockerfile              # Build multi-stage para produção
├── docker-compose.yml      # App + Redis (para dev e prod)
├── eslint.config.mjs       # Configuração ESLint
├── jest.config.ts          # Configuração Jest (testes)
├── package.json
├── tsconfig.json
├── PLANO_ESTRATEGICO.md    # Este documento
│
├── .github/
│   └── workflows/
│       └── ci.yml          # CI: lint, test, build, docker (Node 20/22)
│
├── src/
│   ├── config.ts              # Validação de env com Zod + defaults
│   ├── logger.ts              # Winston + MemoryTransport (2000 entries) + SSE stream
│   ├── database.ts            # SQLite: contacts, messages, warmup_log, webhook_events (localtime)
│   ├── whatsapp-api.ts        # Client Meta Cloud API v21.0 + Circuit Breaker
│   ├── warmup.ts              # Warm-up: 4 fases (50→200→1000→ilimitado), quality gate
│   ├── queue.ts               # BullMQ + delays humanizados (gaussiano, fadiga, pausas)
│   ├── webhook.ts             # Webhook: status updates, incoming msgs, auto-reply IA + tracking
│   ├── contacts.ts            # CRUD contatos + validação BR regex + importação CSV
│   ├── templates.ts           # 14 templates + submissão para Meta
│   ├── content-generator.ts   # Gerador dinâmico de params por template + plano diário
│   ├── tts.ts                 # TTS neural (pt-BR-Thalita/Antonio) + prosódia aleatória
│   ├── conversation-engine.ts # IA: persona Reino, memória 12 msgs, 17 intenções, mood, topics
│   ├── admin-panel.ts         # Painel admin: JWT auth, dashboard, logs 4 tabs, envio, SSE
│   ├── index.ts               # Express: REST + health + rate limit + graceful shutdown + panel
│   └── cli.ts                 # CLI: import CSV, submit templates, fire warmup
│
├── tests/
│   ├── contacts.test.ts        # Validação de telefone
│   ├── circuit-breaker.test.ts # Circuit breaker states
│   ├── templates.test.ts       # Biblioteca de templates
│   ├── warmup.test.ts          # Lógica de fases
│   └── webhook.test.ts         # Verificação de assinatura
│
├── logs/                    # Arquivos de log (auto-criado)
│   ├── app-YYYY-MM-DD.log  # Logs diários
│   └── errors.log           # Somente erros
│
└── data.db                  # SQLite database (auto-criado)
```

---

## 10. ENDPOINTS DA API REST

O servidor roda na porta definida em `PORT` (padrão: 3000).

### Monitoramento
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Health check (DB + Redis) |
| GET | `/api/status` | Status do aquecimento + quality rating |
| GET | `/api/warmup/check` | Verificar se pode avançar de fase |
| GET | `/api/stats` | Estatísticas gerais de envio |
| GET | `/api/stats?template=X` | Estatísticas por template |

### Disparos
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/send/template` | Enviar template para lista de contatos |
| POST | `/api/send/by-tag` | Enviar para contatos filtrados por tag |
| POST | `/api/send/reactivation` | Enviar para contatos inativos |

### Contatos
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/contacts/import` | Importar contatos via CSV |

### Templates
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/templates` | Listar templates aprovados na Meta |
| GET | `/api/templates/local` | Listar biblioteca local de templates |
| POST | `/api/templates/submit` | Submeter 1 template para aprovação |
| POST | `/api/templates/submit-all` | Submeter todos os templates locais |

### Webhook (Meta)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/webhook` | Verificação do webhook pela Meta |
| POST | `/webhook` | Receber eventos (status, mensagens) |

### Painel Admin (`/panel`) — Protegido por JWT
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/panel` | Interface web do painel admin |
| POST | `/panel/api/auth/login` | Login (admin/reino2026) → JWT 24h |
| GET | `/panel/api/dashboard-stats` | Stats: contatos, msgs, warmup, qualidade |
| GET | `/panel/api/contacts?page=N` | Contatos com paginação e busca |
| GET | `/panel/api/messages?page=N` | Mensagens com paginação e filtro status |
| GET | `/panel/api/logs?page=N` | Webhook events paginados |
| GET | `/panel/api/app-logs` | Logs recentes da aplicação (memória) |
| GET | `/panel/api/log-file/:name` | Ler arquivo de log específico |
| GET | `/panel/api/log-stream` | SSE — logs em tempo real |
| GET | `/panel/api/live-feed` | SSE — feed de eventos ao vivo |
| POST | `/panel/api/send/text` | Enviar texto para número |
| POST | `/panel/api/send/audio` | Enviar áudio TTS para número |
| GET | `/panel/api/templates-meta` | Listar templates da Meta |
| GET | `/panel/api/warmup-history` | Histórico de aquecimento 7 dias |

> **Arquivo de teste**: abra `api.http` no VS Code com a extensão REST Client para testar os endpoints.

---

## 11. GUIA DE INTEGRAÇÃO COM APP PRINCIPAL

> Este módulo WhatsApp foi projetado para ser **acoplado como Menu/Categoria** a um app existente.

### 11.1 Opção A — Microserviço Independente (Recomendada)
O módulo roda como serviço separado e o app principal se comunica via HTTP.

```
┌─────────────────────┐         HTTP/REST          ┌──────────────────────┐
│   App Principal     │ ◄─────────────────────────► │  WhatsApp Module     │
│   (qualquer stack)  │    POST /api/send/template  │  (Node.js:3000)      │
│                     │    GET  /api/status          │                      │
│   Menu lateral:     │    GET  /api/stats           │  ┌────────────────┐  │
│   ├── Dashboard     │    POST /api/send/by-tag     │  │ Express API    │  │
│   ├── Clientes      │    ...                       │  │ BullMQ Queue   │  │
│   ├── Pedidos       │                              │  │ SQLite DB      │  │
│   └── 📱 WhatsApp ◄─┤                              │  │ Webhook        │  │
│       ├── Disparos  │                              │  └────────────────┘  │
│       ├── Templates │                              └──────────────────────┘
│       ├── Contatos  │
│       └── Relatórios│
└─────────────────────┘
```

**Como integrar:**
1. O app principal faz chamadas HTTP para `http://whatsapp-service:3000/api/*`
2. Nenhuma dependência de linguagem/framework — funciona com React, Next.js, NestJS, PHP, qualquer stack
3. O SQLite do módulo WhatsApp é independente; se o app principal tiver seu BD, sincronize contatos via API

### 11.2 Opção B — Módulo Embarcado (Monorepo)
Se o app principal for Node.js/TypeScript, copiar a pasta `src/` como submódulo.

```
app-principal/
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   ├── pedidos/
│   │   └── whatsapp/          ← copiar conteúdo de src/
│   │       ├── config.ts
│   │       ├── whatsapp-api.ts
│   │       ├── warmup.ts
│   │       ├── queue.ts
│   │       ├── webhook.ts
│   │       ├── contacts.ts
│   │       ├── templates.ts
│   │       └── index.ts       ← exporta router ao invés de iniciar servidor
│   └── app.ts                 ← importa app.use('/api/whatsapp', whatsappRouter)
```

**Ajustes necessários:**
- Alterar `index.ts` para exportar o router ao invés de chamar `app.listen()`
- Usar o banco de dados do app principal ao invés de SQLite separado
- Compartilhar middleware de autenticação

### 11.3 Estrutura de Menu Sugerida para o Frontend

```
📱 WhatsApp
├── 📊 Dashboard
│   ├── Status do número (quality rating, fase, tier)
│   ├── Mensagens enviadas hoje / limite
│   └── Gráfico de envios últimos 7 dias
│
├── 🚀 Disparos
│   ├── Envio por template (selecionar template + contatos)
│   ├── Envio por tag (selecionar tag + template)
│   └── Reativação (definir dias de inatividade + template)
│
├── 📝 Templates
│   ├── Biblioteca local (ver/editar templates)
│   ├── Templates aprovados (lista da Meta)
│   └── Submeter novo template
│
├── 👥 Contatos
│   ├── Lista de contatos (com filtros por tag, opt-in/out)
│   ├── Importar CSV
│   └── Contatos inativos
│
└── 📈 Relatórios
    ├── Taxa de entrega / leitura por campanha
    ├── Histórico de aquecimento
    └── Opt-outs recentes
```

### 11.4 Autenticação e Segurança na Integração
- Os endpoints da API **não têm autenticação própria** — projetar para funcionar atrás de um API Gateway ou proxy reverso do app principal
- Se expor direto, adicionar middleware de API key ou JWT
- **Nunca** expor as credenciais Meta (WHATSAPP_TOKEN) no frontend
- O webhook `/webhook` deve ficar público (Meta precisa acessar), mas validamos a assinatura `x-hub-signature-256`

---

## 12. PRÓXIMOS PASSOS

### Fase 0 — Infraestrutura Base (✅ CONCLUÍDA)
- [x] Logger Winston + auto-mkdir + MemoryTransport + SSE stream
- [x] Refatorar sendBatch() para BullMQ com delays humanizados (gaussiano, fadiga, pausas)
- [x] Validação de telefone com regex brasileiro
- [x] Graceful shutdown com SIGTERM/SIGINT
- [x] Health check `/health` com status DB + Redis
- [x] Rate limiting no Express (60 req/min por IP)
- [x] Circuit Breaker para Meta API (5 falhas → OPEN 60s)
- [x] Redis connection resilience (retry com backoff)
- [x] Testes unitários Jest (5 suites, 34 testes)
- [x] CI/CD GitHub Actions (lint → test → build → docker)
- [x] Docker multi-stage + docker-compose

### Fase 1 — Setup & Configuração (✅ CONCLUÍDA)
- [x] Node.js 22.22.2 + TypeScript + todas dependências
- [x] Build, lint e testes sem erros
- [x] Conta Meta Business verificada + número registrado (5544988163024)
- [x] Credenciais no `.env` (WHATSAPP_TOKEN, PHONE_NUMBER_ID, WABA_ID, APP_SECRET)
- [x] Redis local (5.0.14 na porta 6379)
- [x] Servidor rodando em localhost:3000
- [x] 14 templates submetidos para Meta (2 aprovados, 12 pendentes)
- [x] Webhook ngrok registrado e funcionando
- [x] Teste real de envio hello_world → 2 mensagens delivered

### Fase 2 — Features Avançadas (✅ CONCLUÍDA)
- [x] TTS Neural (msedge-tts) — vozes Thalita (feminina) e Antonio (masculino) pt-BR
- [x] Gerador de conteúdo dinâmico para templates (`content-generator.ts`)
- [x] Painel Admin web completo em `/panel` com JWT auth (admin/reino2026)
  - Dashboard com stats em tempo real
  - Tabelas de contatos, mensagens, templates
  - Envio de texto e áudio direto do painel
  - Live feed SSE
- [x] Log Center com 4 abas (Tempo Real, App Logs, Webhook Events, Arquivos)
- [x] Logs humanizados em português (sem JSON/código bruto)
- [x] Conversation Engine IA (`conversation-engine.ts`)
  - Persona "Reino - Avisos" com serviços, horário, localização
  - Memória por contato (12 msgs, expira em 4h)
  - Classificação de 17 intenções via regex
  - Detecção de mood (positivo/neutro/negativo)
  - Detecção de 8 tópicos (tela, bateria, acessórios, preço, etc.)
  - State machine para perguntas de follow-up
- [x] Auto-reply inteligente: 70% texto + 30% áudio com prosódia aleatória
- [x] Cooldown de 30s entre respostas automáticas
- [x] Timestamps corrigidos para horário local (UTC-3)
- [x] Auto-replies agora salvas na tabela messages (com wamid para tracking)

### Fase 3 — Aquecimento (🔄 EM ANDAMENTO)
> **Status**: Dia 1 de 7 — Fase 1 (2/50 enviados em 06/04/2026)
- [x] Importar aliados.csv (7 contatos fase1)
- [x] Primeiro disparo warmup: 2 mensagens hello_world enviadas e entregues
- [ ] **AGUARDAR aprovação dos 12 templates pendentes** (necessário para variar conteúdo)
- [ ] Completar disparo Dia 1: enviar para os 5 aliados restantes quando templates aprovarem
- [ ] Dias 2-7: disparar diariamente ~10-50 msgs variando templates utility
- [ ] Monitorar Quality Rating diariamente via painel ou `/api/status`
- [ ] Se Quality GREEN por 7 dias → avançar para Fase 2 (200/dia) no `.env`
- [ ] Expandir lista de contatos gradualmente (clientes reais da loja)

### Fase 4 — Produção & Escala (⬜ PENDENTE)
- [ ] Templates de marketing aprovados → iniciar campanhas
- [ ] Atingir Tier 2 na Meta (10.000 contatos únicos/24h)
- [ ] Migrar de ngrok para domínio próprio com HTTPS (VPS ou Cloudflare Tunnel)
- [ ] Configurar backup automático do SQLite
- [ ] Implementar dashboard de métricas com gráficos (Chart.js ou similar)
- [ ] A/B testing de templates (comparar taxa de leitura entre variações)
- [ ] Segmentação avançada de contatos (por última compra, serviço, região)
- [ ] Fluxos de conversa mais complexos (agendamento automático, orçamento via bot)
- [ ] Integração com sistema de gestão da loja (se houver)

### Fase 5 — Integração com App Principal (⬜ PENDENTE)
- [ ] Definir stack do app principal
- [ ] Escolher Opção A (microserviço) ou B (embarcado) — ver seção 11
- [ ] Criar tela Menu/Categoria "WhatsApp" no frontend
- [ ] Integrar endpoints REST
- [ ] Adicionar autenticação nos endpoints públicos

---

## 13. RESUMO DO QUE FOI FEITO HOJE (06/04/2026)

### Sessão completa — do zero ao sistema operacional:
1. **Infraestrutura**: Configuração completa (config, logger, DB, API, queue, webhook, warmup, templates, contacts, CLI)
2. **Meta Business**: Conta verificada, número registrado, webhook configurado com ngrok
3. **Templates**: 14 criados e submetidos (2 aprovados, 12 aguardando)
4. **Primeiro disparo**: 2 mensagens hello_world para aliados → entregues com sucesso
5. **TTS Audio**: Implementação completa com vozes neurais pt-BR + envio via WhatsApp
6. **Painel Admin**: Interface web completa com login, dashboard, envio, logs, feed ao vivo
7. **IA Conversacional**: Conversation engine com memória, intenções, tópicos, mood e respostas contextuais
8. **Logs**: Centro de logs com 4 abas + humanização em português
9. **Correções finais**: Timezone UTC→localtime, auto-replies salvas no banco, dados históricos corrigidos
