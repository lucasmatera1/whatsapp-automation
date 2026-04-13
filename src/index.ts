import express from "express";
import cors from "cors";
import { config } from "./config";
import { logger } from "./logger";
import { createWebhookRouter, onLiveEvent } from "./webhook";
import { warmupManager } from "./warmup";
import { startWorker, enqueueBulkMessages, messageQueue } from "./queue";
import {
  importContactsFromCSV,
  getContactsByTag,
  getInactiveContacts,
  getCampaignStats,
} from "./contacts";
import { whatsappApi } from "./whatsapp-api";
import { submitTemplate, submitAllTemplates, listLocalTemplates } from "./templates";
import { generateParams, generateDailyPlan } from "./content-generator";
import { startScheduler, stopScheduler, getScheduleInfo, fireSlotNow } from "./scheduler";
import db from "./database";
import http from "http";
import { createAdminRouter, ADMIN_HTML, CHAT_HTML, SETTINGS_HTML } from "./admin-panel";

const app = express();
let server: http.Server;

// Parse JSON raw body (necessário para verificar assinatura do webhook)
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(cors());

// ========================
// Rate Limiting simples (sem dependência extra)
// ========================
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minuto
const RATE_LIMIT_MAX = 60; // 60 req/min

app.use("/api", (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ error: "Too many requests. Tente novamente em breve." });
  }

  next();
});

// Limpar entries expiradas periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 60_000);

// ========================
// Health Check
// ========================
app.get("/health", async (_req, res) => {
  const health = {
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {
      database: "ok" as string,
      redis: "unknown" as string,
    },
  };

  // Verificar SQLite
  try {
    db.prepare("SELECT 1").get();
  } catch {
    health.status = "degraded";
    health.services.database = "down";
  }

  // Verificar Redis (via queue)
  try {
    const client = await messageQueue.client;
    const queueReady = client?.status === "ready";
    health.services.redis = queueReady ? "ok" : "connecting";
    if (!queueReady) health.status = "degraded";
  } catch {
    health.services.redis = "down";
    health.status = "degraded";
  }

  const statusCode = health.status === "ok" ? 200 : 503;
  res.status(statusCode).json(health);
});

// Rotas do Webhook
app.use(createWebhookRouter());

// ========================
// API REST para gerenciar
// ========================

// Status do sistema
app.get("/api/status", async (_req, res) => {
  const report = warmupManager.getDailyReport();
  let quality = null;
  try {
    quality = await whatsappApi.getPhoneQuality();
  } catch { /* ignore */ }

  res.json({
    warmup: report,
    quality,
    circuitBreaker: whatsappApi.getCircuitBreakerState(),
    timestamp: new Date().toISOString(),
  });
});

// Verificar se pode avançar de fase
app.get("/api/warmup/check", async (_req, res) => {
  const result = await warmupManager.checkPhasePromotion();
  res.json({ recommendation: result });
});

// ── Aquecimento Automático ──────────────────────────────
// Dispara o plano diário de aquecimento para contatos com tag específica
app.post("/api/warmup/fire", async (req, res) => {
  const { tag = "fase1", day = 1 } = req.body;

  const contacts = getContactsByTag(tag);
  if (contacts.length === 0) {
    return res.status(404).json({ error: `Nenhum contato com tag "${tag}"` });
  }

  if (!warmupManager.canSendMore()) {
    return res.status(429).json({
      error: "Limite diário atingido",
      remaining: warmupManager.remainingToday(),
    });
  }

  const plan = generateDailyPlan(day, contacts.length);
  const remaining = warmupManager.remainingToday();
  const toSend = plan.slice(0, remaining);

  let enqueued = 0;
  for (let i = 0; i < toSend.length; i++) {
    const msg = toSend[i];
    const contact = contacts[i % contacts.length];
    const params = msg.generateParams(contact.name || contact.phone);

    await enqueueBulkMessages(
      [{ phone: contact.phone, name: contact.name, params: params.length > 0 ? params : undefined }],
      msg.templateName,
      msg.category,
      `warmup-day${day}`,
      msg.languageCode
    );
    enqueued++;
  }

  res.json({
    day,
    planned: plan.length,
    enqueued,
    contacts: contacts.length,
    templatesUsed: [...new Set(toSend.map((m) => m.templateName))],
  });
});

// Enviar template para lista de contatos
app.post("/api/send/template", async (req, res) => {
  const { contacts, templateName, category = "utility", campaignId, languageCode } = req.body;

  if (!contacts || !templateName) {
    return res.status(400).json({ error: "contacts e templateName são obrigatórios" });
  }

  if (!warmupManager.canSendMore()) {
    return res.status(429).json({
      error: "Limite diário de aquecimento atingido",
      remaining: warmupManager.remainingToday(),
    });
  }

  const result = await enqueueBulkMessages(contacts, templateName, category, campaignId, languageCode);
  res.json(result);
});

// Enviar template por tag
app.post("/api/send/by-tag", async (req, res) => {
  const { tag, templateName, category = "marketing", params, languageCode } = req.body;

  if (!tag || !templateName) {
    return res.status(400).json({ error: "tag e templateName são obrigatórios" });
  }

  const contacts = getContactsByTag(tag).map((c) => ({
    phone: c.phone,
    name: c.name,
    params: params || [c.name],
  }));

  if (contacts.length === 0) {
    return res.status(404).json({ error: `Nenhum contato encontrado com a tag "${tag}"` });
  }

  const result = await enqueueBulkMessages(contacts, templateName, category, undefined, languageCode);
  res.json({ contacts: contacts.length, ...result });
});

// Reativação - enviar para contatos inativos
app.post("/api/send/reactivation", async (req, res) => {
  const { days = 30, templateName, params } = req.body;

  if (!templateName) {
    return res.status(400).json({ error: "templateName é obrigatório" });
  }

  const contacts = getInactiveContacts(days).map((c) => ({
    phone: c.phone,
    name: c.name,
    params: params || [c.name],
  }));

  if (contacts.length === 0) {
    return res.json({ message: "Nenhum contato inativo encontrado", contacts: 0 });
  }

  const result = await enqueueBulkMessages(contacts, templateName, "marketing");
  res.json({ inactiveContacts: contacts.length, ...result });
});

// Importar contatos via CSV
app.post("/api/contacts/import", (req, res) => {
  const { filePath } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: "filePath é obrigatório" });
  }

  try {
    const result = importContactsFromCSV(filePath);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Estatísticas de campanha
app.get("/api/stats", (req, res) => {
  const templateName = req.query.template as string | undefined;
  const stats = getCampaignStats(templateName);
  res.json(stats);
});

// Listar templates
app.get("/api/templates", async (_req, res) => {
  try {
    const templates = await whatsappApi.listTemplates();
    res.json(templates);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Listar templates locais (biblioteca)
app.get("/api/templates/local", (_req, res) => {
  res.json(listLocalTemplates());
});

// Submeter template para aprovação na Meta
app.post("/api/templates/submit", async (req, res) => {
  const { templateKey } = req.body;
  if (!templateKey) {
    return res.status(400).json({ error: "templateKey é obrigatório" });
  }
  try {
    const result = await submitTemplate(templateKey);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Submeter todos os templates locais
app.post("/api/templates/submit-all", async (_req, res) => {
  const result = await submitAllTemplates();
  res.json(result);
});

// ── Scheduler ───────────────────────────────────────

// Ver agenda de disparos
app.get("/api/scheduler", (_req, res) => {
  res.json({ slots: getScheduleInfo() });
});

// Ligar/desligar scheduler
app.post("/api/scheduler/toggle", (req, res) => {
  const { enabled } = req.body;
  if (enabled) {
    startScheduler();
    res.json({ status: "started", slots: getScheduleInfo() });
  } else {
    stopScheduler();
    res.json({ status: "stopped" });
  }
});

// Disparar um slot manualmente (para teste)
app.post("/api/scheduler/fire", async (req, res) => {
  const { slotIndex } = req.body;
  if (slotIndex === undefined) {
    return res.status(400).json({ error: "slotIndex é obrigatório (0-3)" });
  }
  const result = await fireSlotNow(slotIndex);
  res.json({ result });
});

// ========================
// SSE - Live Feed
// ========================
app.get("/api/live", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("data: {\"type\":\"connected\"}\n\n");

  const unsub = onLiveEvent((evt) => {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  });

  req.on("close", unsub);
});

// Mensagens recentes do banco
app.get("/api/messages/recent", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT m.id, m.phone, c.name, m.template_name, m.status, m.created_at, m.sent_at
       FROM messages m LEFT JOIN contacts c ON m.phone = c.phone
       ORDER BY m.created_at DESC LIMIT 50`
    )
    .all();
  res.json(rows);
});

// Webhook events recentes
app.get("/api/webhook-events/recent", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT 50`
    )
    .all();
  res.json(rows);
});

// ========================
// Painel Admin
// ========================
app.use("/panel/api", createAdminRouter());
app.get("/panel", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(ADMIN_HTML);
});
app.get("/panel/chat", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(CHAT_HTML);
});
app.get("/panel/settings", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(SETTINGS_HTML);
});

// ========================
// Dashboard HTML (legado - live feed simples)
// ========================
app.get("/dashboard", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(DASHBOARD_HTML);
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Live Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;padding:16px}
h1{font-size:1.4rem;margin-bottom:12px;color:#25D366}
.top{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.card{background:#1a1a2e;border-radius:10px;padding:14px 18px;min-width:140px;text-align:center}
.card .num{font-size:2rem;font-weight:700;color:#25D366}
.card .label{font-size:.75rem;color:#888;margin-top:2px}
#status{display:inline-block;width:10px;height:10px;border-radius:50%;background:#f44;margin-right:6px;vertical-align:middle}
#status.ok{background:#25D366}
.feed{display:flex;gap:16px;flex-wrap:wrap}
.col{flex:1;min-width:320px}
.col h2{font-size:1rem;margin-bottom:8px;color:#aaa;border-bottom:1px solid #333;padding-bottom:4px}
.log{max-height:70vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px}
.evt{background:#16213e;border-left:3px solid #25D366;border-radius:6px;padding:10px 12px;font-size:.85rem;animation:fadeIn .3s}
.evt.incoming{border-color:#00bcd4}
.evt.auto_reply{border-color:#ff9800}
.evt.status{border-color:#9c27b0}
.evt.opt_out{border-color:#f44336}
.evt .time{color:#666;font-size:.7rem}
.evt .from{color:#25D366;font-weight:600}
.evt .body{margin-top:4px;color:#ccc}
@keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>
<h1><span id="status"></span> WhatsApp Live Dashboard</h1>
<div class="top">
  <div class="card"><div class="num" id="cIncoming">0</div><div class="label">Recebidas</div></div>
  <div class="card"><div class="num" id="cReply">0</div><div class="label">Auto-respostas</div></div>
  <div class="card"><div class="num" id="cStatus">0</div><div class="label">Status</div></div>
  <div class="card"><div class="num" id="cOptOut">0</div><div class="label">Opt-out</div></div>
</div>
<div class="feed">
  <div class="col"><h2>Mensagens Recebidas</h2><div class="log" id="logIncoming"></div></div>
  <div class="col"><h2>Auto-respostas &amp; Status</h2><div class="log" id="logOther"></div></div>
</div>
<script>
const counters={incoming:0,auto_reply:0,status:0,opt_out:0};
const els={
  cIncoming:document.getElementById('cIncoming'),
  cReply:document.getElementById('cReply'),
  cStatus:document.getElementById('cStatus'),
  cOptOut:document.getElementById('cOptOut'),
  logIncoming:document.getElementById('logIncoming'),
  logOther:document.getElementById('logOther'),
  status:document.getElementById('status')
};

function upd(){
  els.cIncoming.textContent=counters.incoming;
  els.cReply.textContent=counters.auto_reply;
  els.cStatus.textContent=counters.status;
  els.cOptOut.textContent=counters.opt_out;
}

function ts(d){return new Date(d||Date.now()).toLocaleTimeString('pt-BR')}

function addEvt(evt){
  const t=evt.type||'status';
  if(counters[t]!==undefined)counters[t]++;
  upd();
  const div=document.createElement('div');
  div.className='evt '+t;
  if(t==='incoming'){
    div.innerHTML='<span class="time">'+ts(evt.timestamp)+'</span> <span class="from">'+esc(evt.from||evt.phone||'?')+'</span>'
      +(evt.contactName?' ('+esc(evt.contactName)+')':'')
      +'<div class="body">'+(evt.text||evt.messageType||'mídia')+'</div>';
    els.logIncoming.prepend(div);
  } else if(t==='auto_reply'){
    div.innerHTML='<span class="time">'+ts(evt.timestamp)+'</span> ➜ <span class="from">'+esc(evt.to||'?')+'</span>'
      +'<div class="body">'+esc(evt.text||'')+'</div>';
    els.logOther.prepend(div);
  } else if(t==='status'){
    div.innerHTML='<span class="time">'+ts(evt.timestamp)+'</span> '+esc(evt.phone||'?')+' → <b>'+esc(evt.status||'?')+'</b>';
    els.logOther.prepend(div);
  } else if(t==='opt_out'){
    div.innerHTML='<span class="time">'+ts(evt.timestamp)+'</span> <span style="color:#f44">OPT-OUT</span> '+esc(evt.phone||'?');
    els.logOther.prepend(div);
  }
}

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}

function connect(){
  const es=new EventSource('/api/live');
  es.onopen=()=>{els.status.className='ok'};
  es.onmessage=(e)=>{
    try{const d=JSON.parse(e.data);if(d.type!=='connected')addEvt(d)}catch{}
  };
  es.onerror=()=>{els.status.className='';es.close();setTimeout(connect,3000)};
}
connect();
</script>
</body>
</html>`;

// ========================
// Inicialização
// ========================

async function start(): Promise<void> {
  // Iniciar worker da fila
  const worker = startWorker();

  // Agendar reset diário
  warmupManager.scheduleDailyReset();

  // Iniciar scheduler de aquecimento automático
  startScheduler();
  logger.info("Scheduler de aquecimento iniciado");

  // Iniciar servidor HTTP
  server = app.listen(config.PORT, () => {
    logger.info(`Servidor rodando na porta ${config.PORT}`);
    logger.info(`Webhook URL: http://seu-dominio.com/webhook`);
    logger.info(`Health Check: http://localhost:${config.PORT}/health`);
    logger.info(`API disponível em http://localhost:${config.PORT}/api`);

    const report = warmupManager.getDailyReport();
    logger.info(`Aquecimento: Fase ${report.phase} | ${report.sentToday}/${report.dailyLimit} enviados hoje`);
  });

  // ========================
  // Graceful Shutdown
  // ========================
  const shutdown = async (signal: string) => {
    logger.info(`${signal} recebido. Iniciando graceful shutdown...`);

    // Parar scheduler
    stopScheduler();

    // Parar de aceitar novas conexões
    server.close(() => {
      logger.info("Servidor HTTP fechado");
    });

    // Aguardar worker processar job atual
    try {
      await worker.close();
      logger.info("Worker da fila encerrado");
    } catch (err: any) {
      logger.error("Erro ao fechar worker", { error: err.message });
    }

    // Fechar fila
    try {
      await messageQueue.close();
      logger.info("Fila de mensagens fechada");
    } catch (err: any) {
      logger.error("Erro ao fechar fila", { error: err.message });
    }

    // Fechar banco de dados
    try {
      db.close();
      logger.info("Banco de dados fechado");
    } catch (err: any) {
      logger.error("Erro ao fechar banco", { error: err.message });
    }

    logger.info("Shutdown completo");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  logger.error("Falha ao iniciar", { error: err.message });
  process.exit(1);
});

export default app;
