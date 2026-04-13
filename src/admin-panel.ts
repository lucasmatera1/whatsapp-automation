import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { config } from "./config";
import { logger, getRecentLogs, onLogEntry, readLogFile } from "./logger";
import db from "./database";
import { whatsappApi } from "./whatsapp-api";
import { textToAudio, prepareTextForTTS } from "./tts";
import { warmupManager } from "./warmup";
import { onLiveEvent } from "./webhook";

const router = express.Router();

// Migration: add body column to messages table if not exists
try { db.exec("ALTER TABLE messages ADD COLUMN body TEXT"); } catch { /* already exists */ }

// ========================
// Auth middleware
// ========================
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token as string;
  if (!token) { res.status(401).json({ error: "Token ausente" }); return; }
  try {
    (req as any).user = jwt.verify(token, config.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

// ========================
// Login
// ========================
router.post("/auth/login", (req, res) => {
  const { user, pass } = req.body;
  // Comparação segura contra timing attacks
  const userStr = String(user || "");
  const passStr = String(pass || "");
  const userOk = userStr.length === config.ADMIN_USER.length && crypto.timingSafeEqual(
    Buffer.from(userStr),
    Buffer.from(config.ADMIN_USER)
  );
  const passOk = passStr.length === config.ADMIN_PASS.length && crypto.timingSafeEqual(
    Buffer.from(passStr),
    Buffer.from(config.ADMIN_PASS)
  );
  if (!userOk || !passOk) {
    logger.warn("Login falhou", { ip: req.ip });
    return res.status(401).json({ error: "Credenciais inválidas" });
  }
  const token = jwt.sign({ user: config.ADMIN_USER, role: "admin" }, config.JWT_SECRET, { expiresIn: "24h" });
  logger.info("Login admin bem-sucedido", { ip: req.ip });
  res.json({ token, expiresIn: "24h" });
});

// ========================
// API protegida
// ========================
router.use(authMiddleware);

// Dashboard stats
router.get("/dashboard-stats", async (_req, res) => {
  const contacts = db.prepare("SELECT COUNT(*) as total FROM contacts").get() as any;
  const opted_out = db.prepare("SELECT COUNT(*) as total FROM contacts WHERE opted_out = 1").get() as any;
  const msgs = db.prepare("SELECT COUNT(*) as total FROM messages").get() as any;
  const msgsSent = db.prepare("SELECT COUNT(*) as total FROM messages WHERE status = 'sent' OR status = 'delivered' OR status = 'read'").get() as any;
  const msgsFailed = db.prepare("SELECT COUNT(*) as total FROM messages WHERE status = 'failed'").get() as any;
  const msgsRead = db.prepare("SELECT COUNT(*) as total FROM messages WHERE status = 'read'").get() as any;
  const webhooks = db.prepare("SELECT COUNT(*) as total FROM webhook_events").get() as any;
  const todayMsgs = db.prepare("SELECT COUNT(*) as total FROM messages WHERE date(created_at) = date('now','localtime')").get() as any;

  const report = warmupManager.getDailyReport();
  let quality = null;
  try { quality = await whatsappApi.getPhoneQuality(); } catch { /* ignore */ }

  res.json({
    contacts: { total: contacts.total, optedOut: opted_out.total },
    messages: { total: msgs.total, sent: msgsSent.total, failed: msgsFailed.total, read: msgsRead.total, today: todayMsgs.total },
    webhookEvents: webhooks.total,
    warmup: report,
    quality,
    circuitBreaker: whatsappApi.getCircuitBreakerState(),
  });
});

// Contatos com paginação
router.get("/contacts", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 25);
  const search = req.query.search as string || "";
  const offset = (page - 1) * limit;

  let where = "";
  const params: any[] = [];
  if (search) {
    where = "WHERE phone LIKE ? OR name LIKE ?";
    params.push(`%${search}%`, `%${search}%`);
  }

  const total = (db.prepare(`SELECT COUNT(*) as c FROM contacts ${where}`).get(...params) as any).c;
  const rows = db.prepare(`SELECT * FROM contacts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ contacts: rows, total, page, pages: Math.ceil(total / limit) });
});

// Mensagens com paginação
router.get("/messages", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 25);
  const status = req.query.status as string;
  const offset = (page - 1) * limit;

  let where = "";
  const params: any[] = [];
  if (status) { where = "WHERE m.status = ?"; params.push(status); }

  const total = (db.prepare(`SELECT COUNT(*) as c FROM messages m ${where}`).get(...params) as any).c;
  const rows = db.prepare(
    `SELECT m.*, c.name FROM messages m LEFT JOIN contacts c ON m.contact_phone = c.phone ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  res.json({ messages: rows, total, page, pages: Math.ceil(total / limit) });
});

// Logs do webhook com paginação
router.get("/logs", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 25);
  const type = req.query.type as string;
  const offset = (page - 1) * limit;

  let where = "";
  const params: string[] = [];
  if (type) { where = "WHERE event_type = ?"; params.push(type); }

  const total = (db.prepare(`SELECT COUNT(*) as c FROM webhook_events ${where}`).get(...params) as { c: number }).c;
  const rows = db.prepare(`SELECT * FROM webhook_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ logs: rows, total, page, pages: Math.ceil(total / limit) });
});

// App logs (Winston in-memory buffer)
router.get("/app-logs", (req, res) => {
  const count = Math.min(500, parseInt(req.query.count as string) || 100);
  const level = req.query.level as string || undefined;
  const search = req.query.search as string || undefined;
  res.json(getRecentLogs(count, { level, search }));
});

// Log files (lê do disco)
router.get("/log-file/:name", (req, res) => {
  const name = req.params.name as "combined" | "error";
  if (name !== "combined" && name !== "error") return res.status(400).json({ error: "Arquivo inválido" });
  const lines = Math.min(500, parseInt(req.query.lines as string) || 200);
  const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
  res.json(readLogFile(name, lines, offset));
});

// SSE stream de logs em tempo real
router.get("/log-stream", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write("data: {\"type\":\"connected\"}\n\n");
  const unsub = onLogEntry((entry) => { res.write(`data: ${JSON.stringify(entry)}\n\n`); });
  req.on("close", unsub);
});

// Enviar texto
router.post("/send/text", async (req, res) => {
  const { phone, text } = req.body;
  if (!phone || !text) return res.status(400).json({ error: "phone e text obrigatórios" });
  try {
    const r = await whatsappApi.sendText({ to: phone, body: text });
    const wamid = r.messages?.[0]?.id;
    if (wamid) {
      db.prepare(
        "INSERT OR IGNORE INTO messages (wamid, contact_phone, template_name, body, category, status, sent_at, created_at) VALUES (?, ?, 'manual_text', ?, 'utility', 'sent', datetime('now','localtime'), datetime('now','localtime'))"
      ).run(wamid, phone, text);
    }
    res.json({ success: true, wamid });
  } catch (e: any) {
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// Enviar áudio TTS
router.post("/send/audio", async (req, res) => {
  const { phone, text, voice } = req.body;
  if (!phone || !text) return res.status(400).json({ error: "phone e text obrigatórios" });
  try {
    const cleanText = prepareTextForTTS(text);
    const buffer = await textToAudio(cleanText, { voice: voice || undefined });
    const mediaId = await whatsappApi.uploadMedia(buffer, "audio/mpeg", "audio.mp3");
    const r = await whatsappApi.sendAudio(phone, mediaId);
    const wamid = r.messages?.[0]?.id;
    if (wamid) {
      db.prepare(
        "INSERT OR IGNORE INTO messages (wamid, contact_phone, template_name, body, category, status, sent_at, created_at) VALUES (?, ?, 'manual_audio', ?, 'utility', 'sent', datetime('now','localtime'), datetime('now','localtime'))"
      ).run(wamid, phone, text);
    }
    res.json({ success: true, wamid, audioBytes: buffer.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Templates da Meta
router.get("/templates-meta", async (_req, res) => {
  try {
    const templates = await whatsappApi.listTemplates();
    res.json(templates);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Warmup stats por dia
router.get("/warmup-history", (_req, res) => {
  const rows = db.prepare("SELECT * FROM warmup_log ORDER BY date DESC LIMIT 30").all();
  res.json(rows);
});

// SSE live com auth via query param
router.get("/live-feed", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write("data: {\"type\":\"connected\"}\n\n");
  const unsub = onLiveEvent((evt) => { res.write(`data: ${JSON.stringify(evt)}\n\n`); });
  req.on("close", unsub);
});

// ========================
// Conversational Automation API
// ========================
router.get("/conversational-automation", async (_req, res) => {
  try {
    const data = await whatsappApi.getConversationalAutomation();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

router.post("/conversational-automation", async (req, res) => {
  const { enable_welcome_message, prompts, commands } = req.body;
  try {
    const data = await whatsappApi.setConversationalAutomation({ enable_welcome_message, prompts, commands });
    res.json({ success: true, ...data });
  } catch (e: any) {
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ========================
// Business Profile API
// ========================
router.get("/business-profile", async (_req, res) => {
  try {
    const data = await whatsappApi.getBusinessProfile();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

router.post("/business-profile", async (req, res) => {
  const { about, address, description, email, websites, vertical } = req.body;
  try {
    const data = await whatsappApi.updateBusinessProfile({ about, address, description, email, websites, vertical });
    res.json({ success: true, ...data });
  } catch (e: any) {
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ========================
// Block Users API
// ========================
router.get("/blocked-users", async (_req, res) => {
  try {
    const data = await whatsappApi.getBlockedUsers();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

router.post("/block-user", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "phone obrigatório" });
  try {
    const data = await whatsappApi.blockUser(phone);
    res.json({ success: true, ...data });
  } catch (e: any) {
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

router.post("/unblock-user", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "phone obrigatório" });
  try {
    const data = await whatsappApi.unblockUser(phone);
    res.json({ success: true, ...data });
  } catch (e: any) {
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ========================
// QR Codes API
// ========================
router.get("/qrcodes", async (_req, res) => {
  try {
    const data = await whatsappApi.listQRCodes();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

router.post("/qrcodes", async (req, res) => {
  const { message, format } = req.body;
  if (!message) return res.status(400).json({ error: "message obrigatório" });
  try {
    const data = await whatsappApi.createQRCode(message, format || "PNG");
    res.json({ success: true, ...data });
  } catch (e: any) {
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

router.delete("/qrcodes/:code", async (req, res) => {
  try {
    const data = await whatsappApi.deleteQRCode(req.params.code);
    res.json({ success: true, ...data });
  } catch (e: any) {
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ========================
// Message History API
// ========================
router.get("/message-history", async (req, res) => {
  const { message_id, limit, after, before } = req.query;
  try {
    const data = await whatsappApi.getMessageHistory({
      message_id: message_id as string,
      limit: limit ? parseInt(limit as string) : undefined,
      after: after as string,
      before: before as string,
    });
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ========================
// Chat API — Conversations & Messages
// ========================

// List all conversations
router.get("/conversations", (_req, res) => {
  const msgPhones = db.prepare("SELECT DISTINCT contact_phone as phone FROM messages").all() as any[];
  const wbPhones = db.prepare(
    "SELECT DISTINCT json_extract(payload, '$.phone') as phone FROM webhook_events WHERE event_type = 'incoming_message'"
  ).all() as any[];

  const phoneSet = new Set<string>();
  for (const r of msgPhones) if (r.phone) phoneSet.add(r.phone);
  for (const r of wbPhones) if (r.phone) phoneSet.add(r.phone);

  const convs = [];
  for (const phone of phoneSet) {
    const contact = db.prepare("SELECT name FROM contacts WHERE phone = ?").get(phone) as any;
    const lastOut = db.prepare(
      "SELECT template_name, body, COALESCE(sent_at, created_at) as ts FROM messages WHERE contact_phone = ? ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 1"
    ).get(phone) as any;
    const lastIn = db.prepare(
      "SELECT json_extract(payload, '$.text') as text, created_at as ts FROM webhook_events WHERE event_type = 'incoming_message' AND json_extract(payload, '$.phone') = ? ORDER BY created_at DESC LIMIT 1"
    ).get(phone) as any;

    const outTs = lastOut?.ts || "";
    const inTs = lastIn?.ts || "";
    let lastText: string, lastTime: string, lastDir: string;

    if (inTs > outTs) {
      lastText = lastIn.text || "[mídia]";
      lastTime = inTs;
      lastDir = "in";
    } else if (outTs) {
      lastText = lastOut.body || (lastOut.template_name === "auto_reply" ? "Resposta automática" : lastOut.template_name || "");
      lastTime = outTs;
      lastDir = "out";
    } else {
      lastText = ""; lastTime = ""; lastDir = "";
    }

    convs.push({ phone, name: contact?.name || "", lastText, lastTime, lastDir });
  }

  convs.sort((a, b) => (b.lastTime).localeCompare(a.lastTime));
  res.json(convs);
});

// Messages for a conversation
router.get("/conversations/:phone/messages", (req, res) => {
  const phone = req.params.phone;

  const outgoing = db.prepare(
    "SELECT 'out' as direction, wamid, template_name, body, status, COALESCE(sent_at, created_at) as timestamp FROM messages WHERE contact_phone = ?"
  ).all(phone) as any[];

  const incoming = db.prepare(
    `SELECT 'in' as direction, NULL as wamid, NULL as template_name,
            json_extract(payload, '$.text') as body,
            json_extract(payload, '$.type') as msg_type,
            'received' as status, created_at as timestamp
     FROM webhook_events
     WHERE event_type = 'incoming_message' AND json_extract(payload, '$.phone') = ?`
  ).all(phone) as any[];

  const all = [...outgoing, ...incoming].sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
  const contact = db.prepare("SELECT phone, name, tags, opted_in, opted_out FROM contacts WHERE phone = ?").get(phone);

  res.json({ messages: all, contact });
});

export function createAdminRouter(): express.Router {
  return router;
}

// ========================
// HTML do Painel Admin
// ========================
export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin - WhatsApp Automation</title>
<style>
:root{--bg:#0b0d17;--card:#111827;--border:#1f2937;--accent:#25D366;--accent2:#128C7E;--red:#ef4444;--orange:#f59e0b;--blue:#3b82f6;--purple:#8b5cf6;--text:#e5e7eb;--muted:#6b7280;--input-bg:#1f2937}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
a{color:var(--accent);text-decoration:none}

/* Login */
.login-wrap{display:flex;justify-content:center;align-items:center;height:100vh}
.login-box{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:40px;width:360px;text-align:center}
.login-box h1{color:var(--accent);font-size:1.5rem;margin-bottom:8px}
.login-box p{color:var(--muted);font-size:.85rem;margin-bottom:24px}
.login-box input{width:100%;padding:12px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.95rem;margin-bottom:12px;outline:none}
.login-box input:focus{border-color:var(--accent)}
.login-box button{width:100%;padding:12px;background:var(--accent);color:#000;font-weight:700;border:none;border-radius:8px;font-size:1rem;cursor:pointer}
.login-box button:hover{background:var(--accent2)}
.login-box .err{color:var(--red);font-size:.85rem;margin-top:8px;min-height:20px}

/* Layout */
.app{display:none;height:100vh;overflow:hidden}
.sidebar{width:220px;background:var(--card);border-right:1px solid var(--border);display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:10}
.sidebar .logo{padding:20px;font-size:1.1rem;font-weight:700;color:var(--accent);border-bottom:1px solid var(--border)}
.sidebar nav{flex:1;padding:12px 0}
.sidebar nav a{display:flex;align-items:center;gap:10px;padding:10px 20px;color:var(--muted);font-size:.9rem;transition:.15s}
.sidebar nav a:hover,.sidebar nav a.active{color:var(--text);background:rgba(37,211,102,.08)}
.sidebar nav a.active{border-right:3px solid var(--accent);color:var(--accent)}
.sidebar .user-area{padding:16px;border-top:1px solid var(--border);font-size:.8rem;color:var(--muted)}
.sidebar .user-area button{background:none;border:1px solid var(--border);color:var(--muted);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:.75rem;margin-top:6px;width:100%}
.sidebar .user-area button:hover{border-color:var(--red);color:var(--red)}
.main{margin-left:220px;height:100vh;overflow-y:auto;padding:24px}
.page{display:none}
.page.active{display:block}
h2{font-size:1.3rem;margin-bottom:16px;color:var(--text)}
h3{font-size:1rem;margin-bottom:12px;color:var(--muted)}

/* Cards */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;text-align:center}
.stat .n{font-size:1.8rem;font-weight:700}
.stat .l{font-size:.75rem;color:var(--muted);margin-top:2px}
.stat.green .n{color:var(--accent)}
.stat.blue .n{color:var(--blue)}
.stat.orange .n{color:var(--orange)}
.stat.red .n{color:var(--red)}
.stat.purple .n{color:var(--purple)}

/* Tables */
.tbl-wrap{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{background:rgba(255,255,255,.03);text-align:left;padding:10px 14px;font-weight:600;color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.5px}
td{padding:10px 14px;border-top:1px solid var(--border)}
tr:hover td{background:rgba(255,255,255,.02)}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:600}
.badge.sent{background:rgba(59,130,246,.15);color:var(--blue)}
.badge.delivered{background:rgba(37,211,102,.15);color:var(--accent)}
.badge.read{background:rgba(139,92,246,.15);color:var(--purple)}
.badge.failed{background:rgba(239,68,68,.15);color:var(--red)}
.badge.queued{background:rgba(107,114,128,.15);color:var(--muted)}
.badge.APPROVED{background:rgba(37,211,102,.15);color:var(--accent)}
.badge.PENDING{background:rgba(245,158,11,.15);color:var(--orange)}
.badge.REJECTED{background:rgba(239,68,68,.15);color:var(--red)}

/* Pagination */
.pag{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;font-size:.8rem;color:var(--muted)}
.pag button{background:var(--input-bg);border:1px solid var(--border);color:var(--text);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.8rem}
.pag button:disabled{opacity:.4;cursor:default}

/* Forms */
.form-row{display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.form-row input,.form-row select,.form-row textarea{flex:1;min-width:200px;padding:10px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.9rem;outline:none}
.form-row textarea{min-height:80px;resize:vertical}
.form-row input:focus,.form-row textarea:focus{border-color:var(--accent)}
.btn{padding:10px 20px;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:.9rem}
.btn-primary{background:var(--accent);color:#000}
.btn-primary:hover{background:var(--accent2)}
.btn-blue{background:var(--blue);color:#fff}
.btn-orange{background:var(--orange);color:#000}
.btn-sm{padding:6px 12px;font-size:.8rem}
.result{margin-top:12px;padding:12px;border-radius:8px;font-size:.85rem;display:none}
.result.ok{display:block;background:rgba(37,211,102,.1);color:var(--accent);border:1px solid rgba(37,211,102,.3)}
.result.err{display:block;background:rgba(239,68,68,.1);color:var(--red);border:1px solid rgba(239,68,68,.3)}

/* Live */
.live-dot{width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block;margin-right:6px}
.live-dot.on{background:var(--accent);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.live-log{max-height:50vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-top:12px}
.live-evt{background:var(--input-bg);border-left:3px solid var(--accent);border-radius:6px;padding:10px 12px;font-size:.85rem;animation:fadeIn .3s}
.live-evt.incoming{border-color:#00bcd4}
.live-evt.auto_reply{border-color:var(--orange)}
.live-evt.opt_out{border-color:var(--red)}
.live-evt .t{color:var(--muted);font-size:.7rem}
.live-evt .f{color:var(--accent);font-weight:600}
@keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}

/* Search */
.search-bar{margin-bottom:16px}
.search-bar input{width:100%;max-width:400px;padding:10px 14px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.9rem;outline:none}

/* Log Center */
.log-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:0}
.log-tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--muted);padding:10px 16px;font-size:.85rem;cursor:pointer;transition:.15s}
.log-tab:hover{color:var(--text)}
.log-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.log-panel{display:none}
.log-panel.active{display:block}
.log-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.log-counters{display:flex;gap:8px;margin-bottom:10px}
.lc{font-size:.75rem;padding:3px 10px;border-radius:10px;font-weight:600}
.lc-info{background:rgba(59,130,246,.12);color:var(--blue)}
.lc-warn{background:rgba(245,158,11,.12);color:var(--orange)}
.lc-error{background:rgba(239,68,68,.12);color:var(--red)}
.log-stream{background:#0a0c14;border:1px solid var(--border);border-radius:10px;padding:8px;max-height:60vh;overflow-y:auto;font-size:.8rem;line-height:1.5}
.log-mono{font-family:'Cascadia Code','Fira Code','Consolas',monospace}
.log-row{padding:4px 8px;border-radius:4px;display:flex;gap:10px;align-items:flex-start;border-left:3px solid transparent}
.log-row:hover{background:rgba(255,255,255,.03)}
.log-row.l-error{border-left-color:var(--red);background:rgba(239,68,68,.04)}
.log-row.l-warn{border-left-color:var(--orange);background:rgba(245,158,11,.04)}
.log-row.l-info{border-left-color:var(--blue)}
.log-row .ts{color:var(--muted);font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:.7rem;white-space:nowrap;min-width:130px}
.log-row .lvl{font-size:.65rem;font-weight:700;text-transform:uppercase;min-width:42px;text-align:center;padding:1px 6px;border-radius:4px}
.log-row .lvl.error{background:rgba(239,68,68,.2);color:var(--red)}
.log-row .lvl.warn{background:rgba(245,158,11,.2);color:var(--orange)}
.log-row .lvl.info{background:rgba(59,130,246,.15);color:var(--blue)}
.log-row .msg{flex:1;word-break:break-all}
.log-row .extra{color:var(--muted);font-size:.75rem;font-family:'Cascadia Code','Fira Code','Consolas',monospace;cursor:pointer}
.log-row .extra:hover{color:var(--text)}
.wb-payload{cursor:pointer;transition:.15s;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.75rem}
.wb-payload:hover{color:var(--text)}
.wb-payload.expanded{white-space:pre-wrap;max-width:none;background:var(--input-bg);padding:8px;border-radius:6px;margin-top:4px}
.file-line{padding:2px 8px;border-radius:3px;font-size:.78rem;line-height:1.6;word-break:break-all}
.file-line:hover{background:rgba(255,255,255,.03)}
.file-line .fl-error{color:var(--red)}
.file-line .fl-warn{color:var(--orange)}
.file-line .fl-info{color:var(--blue)}

/* Responsive */
@media(max-width:768px){
  .sidebar{width:60px}.sidebar .logo{font-size:0;padding:14px}.sidebar nav a span{display:none}.sidebar nav a{justify-content:center}
  .main{margin-left:60px;padding:16px}.stats{grid-template-columns:repeat(2,1fr)}
  .sidebar .user-area{display:none}
  .log-tabs{flex-wrap:wrap}.log-tab{padding:8px 10px;font-size:.78rem}
}
</style>
</head>
<body>

<!-- LOGIN -->
<div class="login-wrap" id="loginPage">
  <div class="login-box">
    <h1>🟢 WhatsApp Admin</h1>
    <p>Painel de controle da automação</p>
    <input type="text" id="loginUser" placeholder="Usuário" autocomplete="username">
    <input type="password" id="loginPass" placeholder="Senha" autocomplete="current-password">
    <button onclick="doLogin()">Entrar</button>
    <div class="err" id="loginErr"></div>
  </div>
</div>

<!-- APP -->
<div class="app" id="appPage">
  <div class="sidebar">
    <div class="logo">🟢 WA Admin</div>
    <nav>
      <a href="#" data-page="dash" class="active">📊 <span>Dashboard</span></a>
      <a href="#" data-page="live">🔴 <span>Ao Vivo</span></a>
      <a href="#" data-page="send">✉️ <span>Enviar</span></a>
      <a href="#" data-page="contacts">👥 <span>Contatos</span></a>
      <a href="#" data-page="messages">💬 <span>Mensagens</span></a>
      <a href="#" data-page="templates">📋 <span>Templates</span></a>
      <a href="#" data-page="logs">📜 <span>Logs</span></a>
    </nav>
    <div style="padding:8px 12px"><a href="/panel/chat" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;color:var(--accent);border:1px solid var(--accent);border-radius:8px;font-size:.9rem;font-weight:600;transition:.15s" onmouseover="this.style.background='rgba(37,211,102,.1)'" onmouseout="this.style.background='none'">💬 <span>Chat</span></a></div>
    <div style="padding:0 12px 8px"><a href="/panel/settings" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;color:var(--muted);border:1px solid var(--border);border-radius:8px;font-size:.9rem;font-weight:600;transition:.15s" onmouseover="this.style.background='rgba(255,255,255,.04)';this.style.color='var(--accent)'" onmouseout="this.style.background='none';this.style.color='var(--muted)'">⚙️ <span>Configurações</span></a></div>
    <div class="user-area">
      Admin logado
      <button onclick="doLogout()">Sair</button>
    </div>
  </div>
  <div class="main">

    <!-- DASHBOARD -->
    <div class="page active" id="pageDash">
      <h2>Dashboard</h2>
      <div class="stats" id="dashStats"></div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:300px">
          <h3>Mensagens Recentes</h3>
          <div class="tbl-wrap"><table><thead><tr><th>Telefone</th><th>Template</th><th>Status</th><th>Data</th></tr></thead><tbody id="dashMsgs"></tbody></table></div>
        </div>
        <div style="flex:1;min-width:300px">
          <h3>Aquecimento (últimos 7 dias)</h3>
          <div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Enviadas</th><th>Fase</th></tr></thead><tbody id="dashWarmup"></tbody></table></div>
        </div>
      </div>
    </div>

    <!-- LIVE -->
    <div class="page" id="pageLive">
      <h2><span class="live-dot" id="liveDot"></span> Feed Ao Vivo</h2>
      <div class="stats">
        <div class="stat green"><div class="n" id="lInc">0</div><div class="l">Recebidas</div></div>
        <div class="stat orange"><div class="n" id="lRep">0</div><div class="l">Auto-respostas</div></div>
        <div class="stat red"><div class="n" id="lOpt">0</div><div class="l">Opt-out</div></div>
      </div>
      <div class="live-log" id="liveLog"></div>
    </div>

    <!-- SEND -->
    <div class="page" id="pageSend">
      <h2>Enviar Mensagem</h2>
      <h3>Texto</h3>
      <div class="form-row">
        <input id="sendPhone" placeholder="Telefone (ex: 5544999999999)">
      </div>
      <div class="form-row">
        <textarea id="sendText" placeholder="Mensagem de texto..."></textarea>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="sendText()">Enviar Texto</button>
        <button class="btn btn-orange" onclick="sendAudio()">🎤 Enviar como Áudio</button>
        <select id="sendVoice" style="padding:8px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;color:var(--text)">
          <option value="">Voz aleatória</option>
          <option value="female">Feminina (Thalita)</option>
          <option value="male">Masculino (Antonio)</option>
        </select>
      </div>
      <div class="result" id="sendResult"></div>
    </div>

    <!-- CONTACTS -->
    <div class="page" id="pageContacts">
      <h2>Contatos</h2>
      <div class="search-bar"><input placeholder="Buscar por nome ou telefone..." oninput="searchContacts(this.value)"></div>
      <div class="tbl-wrap"><table><thead><tr><th>Telefone</th><th>Nome</th><th>Tags</th><th>Opt-in</th><th>Opt-out</th><th>Criado</th></tr></thead><tbody id="tblContacts"></tbody></table></div>
      <div class="pag" id="pagContacts"></div>
    </div>

    <!-- MESSAGES -->
    <div class="page" id="pageMessages">
      <h2>Mensagens</h2>
      <div style="margin-bottom:12px">
        <select id="msgFilter" onchange="loadMessages(1)" style="padding:8px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;color:var(--text)">
          <option value="">Todos os status</option>
          <option value="sent">Sent</option><option value="delivered">Delivered</option><option value="read">Read</option><option value="failed">Failed</option><option value="queued">Queued</option>
        </select>
      </div>
      <div class="tbl-wrap"><table><thead><tr><th>WAMID</th><th>Telefone</th><th>Nome</th><th>Template</th><th>Status</th><th>Enviado</th></tr></thead><tbody id="tblMsgs"></tbody></table></div>
      <div class="pag" id="pagMsgs"></div>
    </div>

    <!-- TEMPLATES -->
    <div class="page" id="pageTemplates">
      <h2>Templates na Meta</h2>
      <button class="btn btn-blue btn-sm" onclick="loadTemplates()" style="margin-bottom:12px">🔄 Atualizar</button>
      <div class="tbl-wrap"><table><thead><tr><th>Nome</th><th>Status</th><th>Categoria</th><th>Idioma</th></tr></thead><tbody id="tblTpls"></tbody></table></div>
    </div>

    <!-- LOGS -->
    <div class="page" id="pageLogs">
      <h2>📜 Central de Logs</h2>

      <!-- Sub-tabs -->
      <div class="log-tabs">
        <button class="log-tab active" data-tab="logRealtime" onclick="switchLogTab(this)">🔴 Tempo Real</button>
        <button class="log-tab" data-tab="logApp" onclick="switchLogTab(this)">🖥️ App Logs</button>
        <button class="log-tab" data-tab="logWebhook" onclick="switchLogTab(this)">🔗 Webhook Events</button>
        <button class="log-tab" data-tab="logFiles" onclick="switchLogTab(this)">📁 Arquivos</button>
      </div>

      <!-- REALTIME -->
      <div class="log-panel active" id="logRealtime">
        <div class="log-toolbar">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="live-dot" id="logLiveDot"></span>
            <span style="font-size:.85rem;color:var(--muted)">Stream ao vivo</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="rtLevelFilter" onchange="filterRtLogs()" style="padding:6px 10px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.8rem">
              <option value="">Todos</option><option value="error">Error</option><option value="warn">Warn</option><option value="info">Info</option>
            </select>
            <input id="rtSearch" placeholder="Filtrar..." oninput="filterRtLogs()" style="padding:6px 10px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.8rem;width:160px">
            <button class="btn btn-sm" style="background:var(--input-bg);color:var(--muted);border:1px solid var(--border)" onclick="clearRtLogs()">Limpar</button>
            <label style="font-size:.75rem;color:var(--muted);display:flex;align-items:center;gap:4px"><input type="checkbox" id="rtScroll" checked> Auto-scroll</label>
          </div>
        </div>
        <div class="log-counters">
          <span class="lc lc-info" id="rtcInfo">0 info</span>
          <span class="lc lc-warn" id="rtcWarn">0 warn</span>
          <span class="lc lc-error" id="rtcError">0 error</span>
        </div>
        <div class="log-stream" id="rtStream"></div>
      </div>

      <!-- APP LOGS -->
      <div class="log-panel" id="logApp">
        <div class="log-toolbar">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select id="appLevelFilter" onchange="loadAppLogs()" style="padding:6px 10px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.8rem">
              <option value="">Todos os níveis</option><option value="error">Error</option><option value="warn">Warn</option><option value="info">Info</option>
            </select>
            <input id="appSearch" placeholder="Buscar nos logs..." style="padding:6px 10px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.8rem;width:200px">
            <button class="btn btn-sm btn-primary" onclick="loadAppLogs()">Buscar</button>
            <select id="appCount" onchange="loadAppLogs()" style="padding:6px 10px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.8rem">
              <option value="50">50 entradas</option><option value="100" selected>100 entradas</option><option value="200">200 entradas</option><option value="500">500 entradas</option>
            </select>
          </div>
          <button class="btn btn-sm btn-blue" onclick="loadAppLogs()">🔄 Atualizar</button>
        </div>
        <div class="log-stream" id="appStream"></div>
      </div>

      <!-- WEBHOOK EVENTS -->
      <div class="log-panel" id="logWebhook">
        <div class="log-toolbar">
          <select id="logFilter" onchange="loadLogs(1)" style="padding:6px 10px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.8rem">
            <option value="">Todos os tipos</option>
            <option value="incoming_message">📩 Mensagens recebidas</option>
            <option value="status_sent">📤 Status: sent</option>
            <option value="status_delivered">✅ Status: delivered</option>
            <option value="status_read">👀 Status: read</option>
            <option value="status_failed">❌ Status: failed</option>
          </select>
          <button class="btn btn-sm btn-blue" onclick="loadLogs(1)">🔄 Atualizar</button>
        </div>
        <div class="tbl-wrap"><table><thead><tr><th style="width:50px">ID</th><th style="width:140px">Evento</th><th>Resumo</th><th style="width:150px">Data</th><th style="width:50px"></th></tr></thead><tbody id="tblLogs"></tbody></table></div>
        <div class="pag" id="pagLogs"></div>
      </div>

      <!-- LOG FILES -->
      <div class="log-panel" id="logFiles">
        <div class="log-toolbar">
          <div style="display:flex;gap:8px;align-items:center">
            <select id="fileSelect" onchange="loadLogFile()" style="padding:6px 10px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.8rem">
              <option value="combined">combined.log (todos)</option>
              <option value="error">error.log (apenas erros)</option>
            </select>
            <select id="fileLines" onchange="loadLogFile()" style="padding:6px 10px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.8rem">
              <option value="50">50 linhas</option><option value="100">100 linhas</option><option value="200" selected>200 linhas</option><option value="500">500 linhas</option>
            </select>
            <button class="btn btn-sm btn-blue" onclick="loadLogFile()">🔄 Atualizar</button>
          </div>
          <span id="fileTotalLines" style="font-size:.8rem;color:var(--muted)"></span>
        </div>
        <div class="log-stream log-mono" id="fileStream"></div>
      </div>
    </div>

  </div>
</div>

<script>
let TOKEN = localStorage.getItem('wa_token') || '';
const API = '/panel/api';

// ── Auth ─────────────────────────────
async function doLogin() {
  const user = document.getElementById('loginUser').value;
  const pass = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginErr');
  try {
    const r = await fetch(API + '/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({user, pass}) });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'Erro'; return; }
    TOKEN = d.token; localStorage.setItem('wa_token', TOKEN);
    showApp();
  } catch(e) { errEl.textContent = 'Erro de conexão'; }
}
function doLogout() { TOKEN = ''; localStorage.removeItem('wa_token'); location.reload(); }

function showApp() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appPage').style.display = 'flex';
  loadDashboard();
  connectLive();
}

// Auto-login se tem token
if (TOKEN) {
  fetch(API + '/dashboard-stats', { headers: { Authorization: 'Bearer ' + TOKEN } })
    .then(r => { if (r.ok) showApp(); else { TOKEN = ''; localStorage.removeItem('wa_token'); } })
    .catch(() => {});
}

// Enter para login
document.getElementById('loginPass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

// ── API helper ───────────────────────
async function api(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { ...opts.headers, Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } });
  if (r.status === 401) { doLogout(); throw new Error('Sessão expirada'); }
  return r.json();
}

// ── Navigation ───────────────────────
document.querySelectorAll('.sidebar nav a').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.sidebar nav a').forEach(x => x.classList.remove('active'));
    a.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageId = 'page' + a.dataset.page.charAt(0).toUpperCase() + a.dataset.page.slice(1);
    const el = document.getElementById(pageId);
    if (el) el.classList.add('active');
    // Load data
    const pg = a.dataset.page;
    if (pg === 'dash') loadDashboard();
    else if (pg === 'contacts') loadContacts(1);
    else if (pg === 'messages') loadMessages(1);
    else if (pg === 'templates') loadTemplates();
    else if (pg === 'logs') connectLogStream();
  });
});

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtDate(s) { if (!s) return '-'; try { return new Date(s).toLocaleString('pt-BR'); } catch { return s; } }
function shortWamid(w) { if (!w) return '-'; return w.length > 20 ? w.substring(0,16)+'...' : w; }

// ── Dashboard ────────────────────────
async function loadDashboard() {
  try {
    const d = await api('/dashboard-stats');
    document.getElementById('dashStats').innerHTML =
      '<div class="stat green"><div class="n">'+d.contacts.total+'</div><div class="l">Contatos</div></div>'+
      '<div class="stat blue"><div class="n">'+d.messages.today+'</div><div class="l">Enviadas Hoje</div></div>'+
      '<div class="stat green"><div class="n">'+d.messages.sent+'</div><div class="l">Enviadas Total</div></div>'+
      '<div class="stat purple"><div class="n">'+d.messages.read+'</div><div class="l">Lidas</div></div>'+
      '<div class="stat red"><div class="n">'+d.messages.failed+'</div><div class="l">Falhas</div></div>'+
      '<div class="stat orange"><div class="n">'+d.warmup.sentToday+'/'+d.warmup.dailyLimit+'</div><div class="l">Warmup Fase '+d.warmup.phase+'</div></div>'+
      '<div class="stat '+(d.quality?.quality_rating==='GREEN'?'green':d.quality?.quality_rating==='YELLOW'?'orange':'red')+'"><div class="n">'+(d.quality?.quality_rating==='GREEN'?'🟢 GREEN':d.quality?.quality_rating==='YELLOW'?'🟡 YELLOW':d.quality?.quality_rating==='RED'?'🔴 RED':'?')+'</div><div class="l">Qualidade</div></div>'+
      '<div class="stat blue"><div class="n">'+d.webhookEvents+'</div><div class="l">Eventos Webhook</div></div>';

    // Phone info card
    if (d.quality) {
      const q = d.quality;
      document.getElementById('dashStats').innerHTML +=
        '<div style="grid-column:1/-1;margin-top:8px;padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:8px;font-size:.85rem;color:#94a3b8;display:flex;gap:24px;flex-wrap:wrap">'+
        '<span>📱 <b style="color:#e2e8f0">'+(q.verified_name||'-')+'</b></span>'+
        '<span>📞 '+(q.display_phone_number||'-')+'</span>'+
        '<span>⚡ Throughput: <b style="color:#e2e8f0">'+(q.throughput?.level||'-')+'</b></span>'+
        '<span>✅ Verificação: '+(q.code_verification_status||'-')+'</span>'+
        '<span>☁️ '+(q.platform_type||'-')+'</span>'+
        '<span>🔌 Circuit Breaker: <b style="color:'+(d.circuitBreaker.state==='CLOSED'?'#22c55e':'#ef4444')+'">'+d.circuitBreaker.state+'</b> ('+d.circuitBreaker.failures+' falhas)</span>'+
        '</div>';
    }

    // Recent msgs
    const msgs = await api('/messages?limit=10');
    document.getElementById('dashMsgs').innerHTML = msgs.messages.map(m =>
      '<tr><td>'+esc(m.contact_phone)+'</td><td>'+esc(m.template_name||'-')+'</td><td><span class="badge '+m.status+'">'+m.status+'</span></td><td>'+fmtDate(m.created_at)+'</td></tr>'
    ).join('');

    // Warmup history
    const wh = await api('/warmup-history');
    document.getElementById('dashWarmup').innerHTML = wh.map(w =>
      '<tr><td>'+esc(w.date)+'</td><td>'+w.messages_sent+'</td><td>Fase '+w.phase+'</td></tr>'
    ).join('');
  } catch(e) { console.error('Dashboard error:', e); }
}

// ── Contacts ─────────────────────────
let contactSearch = '';
function searchContacts(q) { contactSearch = q; loadContacts(1); }
async function loadContacts(page) {
  const d = await api('/contacts?page='+page+'&search='+encodeURIComponent(contactSearch));
  document.getElementById('tblContacts').innerHTML = d.contacts.map(c =>
    '<tr><td>'+esc(c.phone)+'</td><td>'+esc(c.name||'-')+'</td><td>'+esc(c.tags||'-')+'</td><td>'+(c.opted_in?'✅':'❌')+'</td><td>'+(c.opted_out?'🔴':'—')+'</td><td>'+fmtDate(c.created_at)+'</td></tr>'
  ).join('');
  document.getElementById('pagContacts').innerHTML =
    '<span>Página '+d.page+' de '+d.pages+' ('+d.total+' contatos)</span><div>'+
    '<button onclick="loadContacts('+(page-1)+')" '+(page<=1?'disabled':'')+'>← Anterior</button> '+
    '<button onclick="loadContacts('+(page+1)+')" '+(page>=d.pages?'disabled':'')+'>Próxima →</button></div>';
}

// ── Messages ─────────────────────────
async function loadMessages(page) {
  const status = document.getElementById('msgFilter')?.value || '';
  const d = await api('/messages?page='+page+(status?'&status='+status:''));
  document.getElementById('tblMsgs').innerHTML = d.messages.map(m =>
    '<tr><td style="font-size:.7rem">'+esc(shortWamid(m.wamid))+'</td><td>'+esc(m.contact_phone)+'</td><td>'+esc(m.name||'-')+'</td><td>'+esc(m.template_name||'-')+'</td><td><span class="badge '+m.status+'">'+m.status+'</span></td><td>'+fmtDate(m.sent_at)+'</td></tr>'
  ).join('');
  document.getElementById('pagMsgs').innerHTML =
    '<span>Página '+d.page+' de '+d.pages+' ('+d.total+')</span><div>'+
    '<button onclick="loadMessages('+(page-1)+')" '+(page<=1?'disabled':'')+'>← Anterior</button> '+
    '<button onclick="loadMessages('+(page+1)+')" '+(page>=d.pages?'disabled':'')+'>Próxima →</button></div>';
}

// ── Templates ────────────────────────
async function loadTemplates() {
  try {
    const tpls = await api('/templates-meta');
    document.getElementById('tblTpls').innerHTML = tpls.map(t =>
      '<tr><td>'+esc(t.name)+'</td><td><span class="badge '+t.status+'">'+t.status+'</span></td><td>'+esc(t.category)+'</td><td>'+esc(t.language)+'</td></tr>'
    ).join('');
  } catch(e) { document.getElementById('tblTpls').innerHTML = '<tr><td colspan="4">Erro ao carregar</td></tr>'; }
}

// ── Logs ─────────────────────────────
function switchLogTab(btn) {
  document.querySelectorAll('.log-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.log-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  const panel = document.getElementById(btn.dataset.tab);
  if (panel) panel.classList.add('active');
  // Auto-load
  const tab = btn.dataset.tab;
  if (tab === 'logApp') loadAppLogs();
  else if (tab === 'logWebhook') loadLogs(1);
  else if (tab === 'logFiles') loadLogFile();
  else if (tab === 'logRealtime') connectLogStream();
}

// ── Humanizar extras dos logs ─────────
function humanizeExtras(extras) {
  const parts = [];
  for (const [k, v] of Object.entries(extras)) {
    const labels = {ip:'IP',code:'Código',subcode:'Sub',type:'Tipo',userMsg:'Detalhe',error:'Erro',phone:'Tel',wamid:'WAMID',template:'Template',status:'Status',contact:'Contato',audioBytes:'Áudio'};
    const label = labels[k] || k;
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (val.length < 120) parts.push(label + ': ' + val);
  }
  return parts.join(' · ');
}

function renderLogRow(entry) {
  const lvl = entry.level || 'info';
  const ts = entry.timestamp || '';
  const msg = entry.message || '';
  const extras = {};
  for (const k of Object.keys(entry)) {
    if (!['timestamp','level','message','service'].includes(k)) extras[k] = entry[k];
  }
  const humanExtra = Object.keys(extras).length ? humanizeExtras(extras) : '';
  const lvlIcon = lvl === 'error' ? '❌' : lvl === 'warn' ? '⚠️' : 'ℹ️';
  return '<div class="log-row l-'+lvl+'">' +
    '<span class="ts">'+esc(ts.substring(11)||ts)+'</span>' +
    '<span class="lvl '+lvl+'">'+lvlIcon+'</span>' +
    '<span class="msg">'+esc(msg)+'</span>' +
    (humanExtra ? '<span class="extra">'+esc(humanExtra)+'</span>' : '') +
    '</div>';
}

// ── Realtime Log Stream ──────────────
let logES = null;
let rtLogs = [];
let rtCounts = {info:0, warn:0, error:0};

function connectLogStream() {
  if (logES) return;
  logES = new EventSource(API + '/log-stream?token=' + TOKEN);
  const dot = document.getElementById('logLiveDot');
  logES.onopen = () => { if(dot) dot.classList.add('on'); };
  logES.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'connected') return;
      rtLogs.push(d);
      if (rtLogs.length > 500) rtLogs.shift();
      if (rtCounts[d.level] !== undefined) rtCounts[d.level]++;
      updateRtCounters();
      appendRtLog(d);
    } catch {}
  };
  logES.onerror = () => { if(dot) dot.classList.remove('on'); logES.close(); logES = null; setTimeout(connectLogStream, 5000); };
}

function updateRtCounters() {
  const el = (id,v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  el('rtcInfo', rtCounts.info + ' info');
  el('rtcWarn', rtCounts.warn + ' warn');
  el('rtcError', rtCounts.error + ' error');
}

function appendRtLog(entry) {
  const lvlFilter = document.getElementById('rtLevelFilter')?.value || '';
  const searchFilter = (document.getElementById('rtSearch')?.value || '').toLowerCase();
  if (lvlFilter && entry.level !== lvlFilter) return;
  if (searchFilter && !entry.message?.toLowerCase().includes(searchFilter) && !JSON.stringify(entry).toLowerCase().includes(searchFilter)) return;
  const stream = document.getElementById('rtStream');
  if (!stream) return;
  stream.insertAdjacentHTML('beforeend', renderLogRow(entry));
  while (stream.children.length > 300) stream.removeChild(stream.firstChild);
  if (document.getElementById('rtScroll')?.checked) stream.scrollTop = stream.scrollHeight;
}

function filterRtLogs() {
  const stream = document.getElementById('rtStream');
  if (!stream) return;
  const lvl = document.getElementById('rtLevelFilter')?.value || '';
  const search = (document.getElementById('rtSearch')?.value || '').toLowerCase();
  let filtered = rtLogs;
  if (lvl) filtered = filtered.filter(l => l.level === lvl);
  if (search) filtered = filtered.filter(l => l.message?.toLowerCase().includes(search) || JSON.stringify(l).toLowerCase().includes(search));
  stream.innerHTML = filtered.map(renderLogRow).join('');
  if (document.getElementById('rtScroll')?.checked) stream.scrollTop = stream.scrollHeight;
}

function clearRtLogs() {
  rtLogs = []; rtCounts = {info:0, warn:0, error:0};
  updateRtCounters();
  const s = document.getElementById('rtStream'); if(s) s.innerHTML = '';
}

// ── App Logs (in-memory buffer) ──────
async function loadAppLogs() {
  const level = document.getElementById('appLevelFilter')?.value || '';
  const search = document.getElementById('appSearch')?.value || '';
  const count = document.getElementById('appCount')?.value || '100';
  try {
    const logs = await api('/app-logs?count='+count+(level?'&level='+level:'')+(search?'&search='+encodeURIComponent(search):''));
    const stream = document.getElementById('appStream');
    if (stream) stream.innerHTML = logs.length ? logs.map(renderLogRow).join('') : '<div style="padding:20px;text-align:center;color:var(--muted)">Nenhum log encontrado</div>';
  } catch(e) { console.error(e); }
}

// Store webhook data for copy
let _wbCache = {};
function togglePayload(el) { el.classList.toggle('expanded'); const d = el.querySelector('.wb-full'); if(d) d.style.display = d.style.display === 'none' ? 'block' : 'none'; }
function copyWb(id) { if (_wbCache[id]) navigator.clipboard.writeText(JSON.stringify(_wbCache[id], null, 2)); }

// ── Traduzir tipos de evento ─────────
const EVT_LABELS = {
  'incoming_message': {icon:'📩', label:'Mensagem recebida'},
  'status_sent': {icon:'📤', label:'Enviada'},
  'status_delivered': {icon:'✅', label:'Entregue'},
  'status_read': {icon:'👀', label:'Lida'},
  'status_failed': {icon:'❌', label:'Falhou'},
};

function humanizeWebhook(type, payload) {
  try {
    const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (type === 'incoming_message') {
      const name = p.contact || p.phone || '?';
      const txt = p.text ? '"' + p.text.substring(0, 80) + '"' : '[' + (p.type || 'msg') + ']';
      return name + ' enviou: ' + txt;
    }
    if (type.startsWith('status_')) {
      const phone = p.recipient_id || p.id?.substring(0,16) || '?';
      if (p.errors?.length) return 'Falha: ' + (p.errors[0].title || 'erro desconhecido');
      return 'Msg ' + (p.id?.substring(0,12)||'?') + '...';
    }
  } catch {}
  return typeof payload === 'string' ? payload.substring(0,80) : '';
}

// ── Webhook Logs ─────────────────────
async function loadLogs(page) {
  const type = document.getElementById('logFilter')?.value || '';
  const d = await api('/logs?page='+page+(type?'&type='+type:''));
  document.getElementById('tblLogs').innerHTML = d.logs.map(l => {
    _wbCache[l.id] = l;
    const evt = EVT_LABELS[l.event_type] || {icon:'📋', label: l.event_type};
    const summary = humanizeWebhook(l.event_type, l.payload);
    const evtClass = l.event_type?.includes('failed') ? 'failed' : l.event_type?.includes('read') ? 'read' : l.event_type?.includes('delivered') ? 'delivered' : l.event_type?.includes('sent') ? 'sent' : '';
    let fullPayload = '';
    try { fullPayload = JSON.stringify(JSON.parse(l.payload), null, 2); } catch { fullPayload = l.payload || ''; }
    return '<tr><td>'+l.id+'</td>'+
      '<td><span class="badge '+evtClass+'">'+evt.icon+' '+esc(evt.label)+'</span></td>'+
      '<td><div class="wb-payload" onclick="togglePayload(this)">'+esc(summary)+'<div class="wb-full" style="display:none"><pre style="margin:6px 0;white-space:pre-wrap;font-size:.72rem;color:var(--muted)">'+esc(fullPayload)+'</pre></div></div></td>'+
      '<td>'+fmtDate(l.created_at)+'</td>'+
      '<td><button class="btn btn-sm" style="background:var(--input-bg);color:var(--muted);border:1px solid var(--border);padding:2px 8px;font-size:.7rem" onclick="copyWb('+l.id+')">📋</button></td></tr>';
  }).join('');
  document.getElementById('pagLogs').innerHTML =
    '<span>Página '+d.page+' de '+d.pages+' ('+d.total+' eventos)</span><div>'+
    '<button onclick="loadLogs('+(page-1)+')" '+(page<=1?'disabled':'')+'>← Anterior</button> '+
    '<button onclick="loadLogs('+(page+1)+')" '+(page>=d.pages?'disabled':'')+'>Próxima →</button></div>';
}

// ── Log Files ────────────────────────
async function loadLogFile() {
  const name = document.getElementById('fileSelect')?.value || 'combined';
  const lines = document.getElementById('fileLines')?.value || '200';
  try {
    const d = await api('/log-file/'+name+'?lines='+lines);
    document.getElementById('fileTotalLines').textContent = d.total + ' linhas no arquivo';
    const stream = document.getElementById('fileStream');
    if (stream) {
      stream.innerHTML = d.lines.map(line => {
        try {
          const p = JSON.parse(line);
          const lvl = p.level || 'info';
          const lvlIcon = lvl === 'error' ? '❌' : lvl === 'warn' ? '⚠️' : 'ℹ️';
          const ts = (p.timestamp || '').substring(11) || p.timestamp || '';
          const msg = p.message || '';
          const extras = {};
          for (const k of Object.keys(p)) { if (!['timestamp','level','message','service'].includes(k)) extras[k] = p[k]; }
          const extraStr = Object.keys(extras).length ? ' · ' + humanizeExtras(extras) : '';
          return '<div class="file-line"><span class="fl-'+lvl+'">'+esc(ts)+' '+lvlIcon+' '+esc(msg)+esc(extraStr)+'</span></div>';
        } catch {
          return '<div class="file-line">'+esc(line)+'</div>';
        }
      }).join('');
    }
  } catch(e) { console.error(e); }
}

// ── Send ─────────────────────────────
async function sendText() {
  const phone = document.getElementById('sendPhone').value.trim();
  const text = document.getElementById('sendText').value.trim();
  const el = document.getElementById('sendResult');
  if (!phone || !text) { el.className='result err'; el.textContent='Preencha telefone e texto'; return; }
  el.className='result'; el.style.display='none';
  try {
    const d = await api('/send/text', { method:'POST', body:JSON.stringify({phone, text}) });
    el.className='result ok'; el.textContent='Texto enviado! WAMID: '+(d.wamid||'?');
  } catch(e) { el.className='result err'; el.textContent='Erro: '+e.message; }
}

async function sendAudio() {
  const phone = document.getElementById('sendPhone').value.trim();
  const text = document.getElementById('sendText').value.trim();
  const voice = document.getElementById('sendVoice').value || undefined;
  const el = document.getElementById('sendResult');
  if (!phone || !text) { el.className='result err'; el.textContent='Preencha telefone e texto'; return; }
  el.className='result ok'; el.textContent='Gerando áudio TTS... aguarde';
  try {
    const d = await api('/send/audio', { method:'POST', body:JSON.stringify({phone, text, voice}) });
    el.className='result ok'; el.textContent='Áudio enviado! '+d.audioBytes+' bytes | WAMID: '+(d.wamid||'?');
  } catch(e) { el.className='result err'; el.textContent='Erro: '+e.message; }
}

// ── Live feed ────────────────────────
let liveCounts = {incoming:0, auto_reply:0, opt_out:0};
function connectLive() {
  const es = new EventSource(API + '/live-feed?token=' + TOKEN);
  const dot = document.getElementById('liveDot');
  es.onopen = () => { dot.classList.add('on'); };
  es.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'connected') return;
      if (liveCounts[d.type] !== undefined) liveCounts[d.type]++;
      document.getElementById('lInc').textContent = liveCounts.incoming;
      document.getElementById('lRep').textContent = liveCounts.auto_reply;
      document.getElementById('lOpt').textContent = liveCounts.opt_out;
      const log = document.getElementById('liveLog');
      const div = document.createElement('div');
      div.className = 'live-evt ' + (d.type||'');
      const time = new Date(d.timestamp||Date.now()).toLocaleTimeString('pt-BR');
      if (d.type === 'incoming') {
        div.innerHTML = '<span class="t">'+time+'</span> <span class="f">'+esc(d.phone||'?')+'</span> '+(d.name?'('+esc(d.name)+')':'')+'<div>'+esc(d.text||'')+'</div>';
      } else if (d.type === 'auto_reply') {
        div.innerHTML = '<span class="t">'+time+'</span> ➜ <span class="f">'+esc(d.phone||'?')+'</span><div>'+esc(d.text||'')+'</div>';
      } else if (d.type === 'opt_out') {
        div.innerHTML = '<span class="t">'+time+'</span> <b style="color:var(--red)">OPT-OUT</b> '+esc(d.phone||'?');
      }
      log.prepend(div);
      // Limit DOM
      while (log.children.length > 100) log.removeChild(log.lastChild);
    } catch {}
  };
  es.onerror = () => { dot.classList.remove('on'); es.close(); setTimeout(connectLive, 5000); };
}
</script>
</body>
</html>`;

// ========================
// HTML do Chat
// ========================
export const CHAT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chat - WhatsApp Automation</title>
<style>
:root{--bg:#0b0d17;--sidebar:#111827;--border:#1f2937;--accent:#25D366;--accent2:#128C7E;--red:#ef4444;--blue:#3b82f6;--text:#e5e7eb;--muted:#6b7280;--input-bg:#1f2937;--msg-out:#005c4b;--msg-in:#1e293b;--chat-bg:#0a0f1a}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);overflow:hidden}
a{color:var(--accent);text-decoration:none}

.login-wrap{display:flex;justify-content:center;align-items:center;height:100vh}
.login-box{background:var(--sidebar);border:1px solid var(--border);border-radius:16px;padding:40px;width:360px;text-align:center}
.login-box h1{color:var(--accent);font-size:1.5rem;margin-bottom:8px}
.login-box p{color:var(--muted);font-size:.85rem;margin-bottom:24px}
.login-box input{width:100%;padding:12px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.95rem;margin-bottom:12px;outline:none}
.login-box input:focus{border-color:var(--accent)}
.login-box button{width:100%;padding:12px;background:var(--accent);color:#000;font-weight:700;border:none;border-radius:8px;font-size:1rem;cursor:pointer}
.login-box button:hover{background:var(--accent2)}
.login-box .err{color:var(--red);font-size:.85rem;margin-top:8px;min-height:20px}

.chat-app{display:flex;height:100vh;overflow:hidden}

/* Sidebar */
.chat-sidebar{width:360px;background:var(--sidebar);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0}
.sidebar-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border)}
.sidebar-header h2{font-size:1.1rem;color:var(--text);display:flex;align-items:center;gap:8px}
.sidebar-header a{color:var(--muted);font-size:.85rem;padding:6px 12px;border:1px solid var(--border);border-radius:6px}
.sidebar-header a:hover{color:var(--accent);border-color:var(--accent)}
.search-box{padding:8px 12px;border-bottom:1px solid var(--border)}
.search-box input{width:100%;padding:10px 14px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.9rem;outline:none}
.search-box input:focus{border-color:var(--accent)}
.conv-list{flex:1;overflow-y:auto}
.conv-item{display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.03);transition:.15s}
.conv-item:hover{background:rgba(255,255,255,.04)}
.conv-item.active{background:rgba(37,211,102,.08);border-right:3px solid var(--accent)}
.conv-avatar{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;color:#fff;flex-shrink:0}
.conv-info{flex:1;min-width:0}
.conv-name{font-weight:600;font-size:.95rem;display:flex;justify-content:space-between}
.conv-name .time{font-size:.7rem;color:var(--muted);font-weight:400}
.conv-preview{font-size:.82rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.conv-preview .dir{color:var(--accent)}
.conv-empty{padding:40px;text-align:center;color:var(--muted);font-size:.9rem}

/* Main area */
.chat-main{flex:1;display:flex;flex-direction:column;background:var(--chat-bg)}
.empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--muted)}
.empty-state .icon{font-size:4rem;margin-bottom:16px;opacity:.3}
.empty-state h3{font-size:1.2rem;margin-bottom:8px;color:var(--text)}

/* Chat header */
.chat-header{display:flex;align-items:center;gap:12px;padding:12px 20px;background:var(--sidebar);border-bottom:1px solid var(--border);flex-shrink:0}
.chat-header .avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff}
.chat-header .info .name{font-weight:600;font-size:.95rem}
.chat-header .info .phone{font-size:.8rem;color:var(--muted)}
.chat-header .actions{margin-left:auto;display:flex;gap:8px}
.chat-header .actions button{background:var(--input-bg);border:1px solid var(--border);color:var(--muted);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:.8rem}
.chat-header .actions button:hover{color:var(--text);border-color:var(--accent)}
.chat-header .actions button.danger:hover{color:var(--red);border-color:var(--red)}

/* Messages */
.messages-area{flex:1;overflow-y:auto;padding:16px 60px;display:flex;flex-direction:column;gap:2px}
.date-sep{text-align:center;margin:12px 0}
.date-sep span{background:rgba(37,211,102,.1);color:var(--accent);font-size:.72rem;padding:4px 12px;border-radius:8px}
.msg{max-width:65%;padding:8px 12px;border-radius:8px;font-size:.9rem;line-height:1.4;position:relative;word-wrap:break-word}
.msg.out{background:var(--msg-out);align-self:flex-end;border-bottom-right-radius:2px}
.msg.in{background:var(--msg-in);align-self:flex-start;border-bottom-left-radius:2px}
.msg .meta{display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:2px}
.msg .meta .time{font-size:.68rem;color:rgba(255,255,255,.5)}
.msg .meta .status{font-size:.7rem}
.msg .label{font-size:.7rem;color:var(--accent);font-weight:600;display:block;margin-bottom:2px}
.msg .body{white-space:pre-wrap}
.tick-sent{color:rgba(255,255,255,.4)}
.tick-delivered{color:rgba(255,255,255,.5)}
.tick-read{color:#53bdeb}
.tick-failed{color:var(--red)}

/* Input bar */
.input-bar{display:flex;align-items:flex-end;gap:8px;padding:12px 16px;background:var(--sidebar);border-top:1px solid var(--border);flex-shrink:0}
.input-bar textarea{flex:1;padding:10px 14px;background:var(--input-bg);border:1px solid var(--border);border-radius:20px;color:var(--text);font-size:.9rem;font-family:inherit;outline:none;resize:none;max-height:120px;line-height:1.3}
.input-bar textarea:focus{border-color:var(--accent)}
.input-bar .send-btn,.input-bar .audio-btn{width:42px;height:42px;border-radius:50%;border:none;cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.input-bar .send-btn{background:var(--accent);color:#000}
.input-bar .send-btn:hover{background:var(--accent2)}
.input-bar .audio-btn{background:var(--input-bg);border:1px solid var(--border);color:var(--text)}
.input-bar .audio-btn:hover{border-color:var(--accent);color:var(--accent)}
.sending .send-btn,.sending .audio-btn{opacity:.5;pointer-events:none}

/* Toast */
.toast{position:fixed;bottom:20px;right:20px;padding:10px 20px;border-radius:8px;font-size:.85rem;z-index:100;animation:fadeInUp .3s;display:none}
.toast.ok{display:block;background:rgba(37,211,102,.15);color:var(--accent);border:1px solid rgba(37,211,102,.3)}
.toast.err{display:block;background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.3)}
@keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

@media(max-width:768px){
  .chat-sidebar{width:80px}
  .sidebar-header h2 span,.conv-info,.search-box{display:none}
  .sidebar-header{justify-content:center}
  .conv-item{justify-content:center;padding:12px 8px}
  .messages-area{padding:12px 16px}
}
</style>
</head>
<body>

<!-- LOGIN -->
<div class="login-wrap" id="loginPage">
  <div class="login-box">
    <h1>💬 WhatsApp Chat</h1>
    <p>Visualize todas as conversas</p>
    <input type="text" id="loginUser" placeholder="Usuário" autocomplete="username">
    <input type="password" id="loginPass" placeholder="Senha" autocomplete="current-password">
    <button onclick="doLogin()">Entrar</button>
    <div class="err" id="loginErr"></div>
  </div>
</div>

<!-- CHAT APP -->
<div class="chat-app" id="chatApp" style="display:none">
  <div class="chat-sidebar" id="chatSidebar">
    <div class="sidebar-header">
      <h2>💬 Conversas</h2>
      <a href="/panel">⬅ Painel</a>
      <a href="/panel/settings">⚙️</a>
    </div>
    <div class="search-box">
      <input id="convSearch" placeholder="Buscar conversa..." oninput="filterConvs()">
    </div>
    <div class="conv-list" id="convList"></div>
  </div>

  <div class="chat-main">
    <div id="emptyState" class="empty-state">
      <div class="icon">💬</div>
      <h3>Selecione uma conversa</h3>
      <p>Escolha um contato para ver as mensagens</p>
    </div>
    <div id="chatView" style="display:none;flex-direction:column;flex:1">
      <div class="chat-header" id="chatHeader"></div>
      <div class="messages-area" id="messagesArea"></div>
      <div class="input-bar" id="inputBar">
        <textarea id="msgInput" placeholder="Digite uma mensagem..." rows="1"></textarea>
        <button class="send-btn" onclick="sendMsg('text')" title="Enviar texto">📤</button>
        <button class="audio-btn" onclick="sendMsg('audio')" title="Enviar como áudio">🎤</button>
      </div>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
let TOKEN = localStorage.getItem('wa_token') || '';
const API = '/panel/api';
let activePhone = null;
let conversations = [];
let refreshTimer = null;
let convTimer = null;
let lastMsgCount = 0;

// ── Auth ─────────────────────────────
async function doLogin() {
  const user = document.getElementById('loginUser').value;
  const pass = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginErr');
  try {
    const r = await fetch(API + '/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({user, pass}) });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'Erro'; return; }
    TOKEN = d.token; localStorage.setItem('wa_token', TOKEN);
    showChat();
  } catch(e) { errEl.textContent = 'Erro de conexão'; }
}

function showChat() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('chatApp').style.display = 'flex';
  loadConversations();
  convTimer = setInterval(loadConversations, 10000);
  connectSSE();
}

if (TOKEN) {
  fetch(API + '/dashboard-stats', { headers: { Authorization: 'Bearer ' + TOKEN } })
    .then(r => { if (r.ok) showChat(); else { TOKEN = ''; localStorage.removeItem('wa_token'); } })
    .catch(() => {});
}

document.getElementById('loginPass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

// ── API ──────────────────────────────
async function api(path) {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (r.status === 401) { TOKEN = ''; localStorage.removeItem('wa_token'); location.reload(); }
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) { TOKEN = ''; localStorage.removeItem('wa_token'); location.reload(); }
  return r.json();
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ── Time helpers ─────────────────────
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return mins + ' min';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  return new Date(ts).toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'});
}
function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit', year:'numeric'});
}
function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
}
function avatarColor(phone) {
  const colors = ['#128C7E','#25D366','#075E54','#34B7F1','#6C63FF','#E74C3C','#F39C12','#8E44AD'];
  let h = 0;
  for (let i = 0; i < phone.length; i++) h = phone.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

// ── Conversations ────────────────────
async function loadConversations() {
  try {
    conversations = await api('/conversations');
    renderConversations();
  } catch(e) { console.error('conv error:', e); }
}

function renderConversations() {
  const search = (document.getElementById('convSearch')?.value || '').toLowerCase();
  const filtered = conversations.filter(c =>
    c.phone.includes(search) || (c.name || '').toLowerCase().includes(search)
  );
  const el = document.getElementById('convList');
  if (!filtered.length) {
    el.innerHTML = '<div class="conv-empty">Nenhuma conversa encontrada</div>';
    return;
  }
  el.innerHTML = filtered.map(c => {
    const displayName = c.name || c.phone;
    const preview = c.lastDir === 'out'
      ? '<span class="dir">Você: </span>' + esc(truncate(c.lastText, 40))
      : esc(truncate(c.lastText, 50));
    const isActive = c.phone === activePhone;
    return '<div class="conv-item' + (isActive ? ' active' : '') + '" onclick="openChat(\\'' + c.phone + '\\')">' +
      '<div class="conv-avatar" style="background:' + avatarColor(c.phone) + '">' + esc(initials(c.name || c.phone.slice(-4))) + '</div>' +
      '<div class="conv-info">' +
        '<div class="conv-name"><span>' + esc(displayName) + '</span><span class="time">' + timeAgo(c.lastTime) + '</span></div>' +
        '<div class="conv-preview">' + preview + '</div>' +
      '</div></div>';
  }).join('');
}

function truncate(s, n) { return (s || '').length > n ? s.substring(0, n) + '...' : (s || ''); }
function filterConvs() { renderConversations(); }

// ── Open chat ────────────────────────
async function openChat(phone) {
  activePhone = phone;
  renderConversations();
  document.getElementById('emptyState').style.display = 'none';
  const cv = document.getElementById('chatView');
  cv.style.display = 'flex';
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadMessages(phone), 5000);
  lastMsgCount = 0;
  await loadMessages(phone);
  document.getElementById('msgInput').focus();
}

// ── Load messages ────────────────────
async function loadMessages(phone) {
  if (phone !== activePhone) return;
  try {
    const data = await api('/conversations/' + encodeURIComponent(phone) + '/messages');
    renderChatHeader(data.contact, phone);
    renderMessages(data.messages);
  } catch(e) { console.error('msg error:', e); }
}

function renderChatHeader(contact, phone) {
  const name = contact?.name || phone;
  const blocked = blockedSet.has(phone);
  document.getElementById('chatHeader').innerHTML =
    '<div class="avatar" style="background:' + avatarColor(phone) + '">' + esc(initials(contact?.name || phone.slice(-4))) + '</div>' +
    '<div class="info"><div class="name">' + esc(name) + '</div><div class="phone">' + esc(phone) + (contact?.tags ? ' · ' + esc(contact.tags) : '') + (blocked ? ' · <span style="color:var(--red)">🚫 Bloqueado</span>' : '') + '</div></div>' +
    '<div class="actions">' +
      '<button onclick="syncHistory(\\'' + phone + '\\')" title="Buscar histórico da Meta">📥 Sync</button>' +
      '<button class="danger" onclick="toggleBlock(\\'' + phone + '\\')">' + (blocked ? '🔓 Desbloquear' : '🚫 Bloquear') + '</button>' +
      '<button onclick="loadMessages(\\'' + phone + '\\')">🔄</button>' +
    '</div>';
}

function statusTick(status) {
  switch(status) {
    case 'queued': return '<span class="tick-sent">🕐</span>';
    case 'sent': return '<span class="tick-sent">✓</span>';
    case 'delivered': return '<span class="tick-delivered">✓✓</span>';
    case 'read': return '<span class="tick-read">✓✓</span>';
    case 'failed': return '<span class="tick-failed">❌</span>';
    default: return '';
  }
}

function msgText(m) {
  if (m.direction === 'in') return m.body || m.text || '[mensagem]';
  if (m.body) return m.body;
  if (m.template_name === 'auto_reply') return 'Resposta automática';
  if (m.template_name === 'manual_text') return '[texto manual]';
  if (m.template_name === 'manual_audio') return '[áudio]';
  if (m.template_name) return '📋 ' + m.template_name;
  return '[mensagem]';
}

function renderMessages(messages) {
  const area = document.getElementById('messagesArea');
  const wasBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 60;
  let html = '';
  let lastDate = '';

  for (const m of messages) {
    const date = fmtDate(m.timestamp);
    if (date !== lastDate) {
      html += '<div class="date-sep"><span>' + esc(date) + '</span></div>';
      lastDate = date;
    }
    const dir = m.direction === 'in' ? 'in' : 'out';
    const text = msgText(m);
    const time = fmtTime(m.timestamp);
    const tick = dir === 'out' ? statusTick(m.status) : '';
    let label = '';
    if (dir === 'out') {
      if (m.template_name === 'auto_reply') label = '<span class="label">🤖 Auto</span>';
      else if (m.template_name === 'manual_audio') label = '<span class="label">🎤 Áudio</span>';
      else if (m.template_name && m.template_name !== 'manual_text') label = '<span class="label">📋 Template</span>';
    }
    html += '<div class="msg ' + dir + '">' + label +
      '<div class="body">' + esc(text) + '</div>' +
      '<div class="meta"><span class="time">' + time + '</span>' + tick + '</div></div>';
  }

  area.innerHTML = html;
  if (wasBottom || lastMsgCount !== messages.length) {
    area.scrollTop = area.scrollHeight;
  }
  lastMsgCount = messages.length;
}

// ── Send ─────────────────────────────
async function sendMsg(type) {
  if (!activePhone) return;
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text) return;
  const bar = document.getElementById('inputBar');
  bar.classList.add('sending');
  try {
    if (type === 'audio') {
      await apiPost('/send/audio', { phone: activePhone, text });
    } else {
      await apiPost('/send/text', { phone: activePhone, text });
    }
    input.value = '';
    input.style.height = 'auto';
    await loadMessages(activePhone);
    showToast(type === 'audio' ? 'Áudio enviado!' : 'Mensagem enviada!', 'ok');
  } catch(e) {
    showToast('Erro ao enviar', 'err');
  } finally {
    bar.classList.remove('sending');
  }
}

// Auto-resize textarea
document.getElementById('msgInput')?.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});
// Enter = send, Shift+Enter = newline
document.getElementById('msgInput')?.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg('text'); }
});

// ── SSE real-time ────────────────────
function connectSSE() {
  const es = new EventSource(API + '/live-feed?token=' + TOKEN);
  es.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'connected') return;
      loadConversations();
      if (activePhone && d.phone === activePhone) {
        loadMessages(activePhone);
      }
    } catch {}
  };
  es.onerror = () => { es.close(); setTimeout(connectSSE, 5000); };
}

// ── Block / Unblock ──────────────────
let blockedSet = new Set();
async function loadBlockedUsers() {
  try {
    const data = await api('/blocked-users');
    blockedSet = new Set((data?.data || data?.block_users || []).map(u => u.user || u));
  } catch { /* ignore */ }
}
loadBlockedUsers();

async function toggleBlock(phone) {
  const action = blockedSet.has(phone) ? 'unblock' : 'block';
  if (!confirm((action === 'block' ? 'Bloquear ' : 'Desbloquear ') + phone + '?')) return;
  try {
    await apiPost('/' + action + '-user', { phone });
    if (action === 'block') blockedSet.add(phone); else blockedSet.delete(phone);
    showToast(action === 'block' ? 'Usuário bloqueado' : 'Usuário desbloqueado', 'ok');
    if (activePhone === phone) loadMessages(phone);
  } catch(e) { showToast('Erro: ' + (e.message || 'falha'), 'err'); }
}

// ── Sync Message History ─────────────
async function syncHistory(phone) {
  try {
    showToast('Buscando histórico da Meta...', 'ok');
    const data = await api('/message-history?limit=50');
    showToast('Histórico carregado: ' + (data?.data?.length || 0) + ' registros', 'ok');
    if (activePhone === phone) await loadMessages(phone);
  } catch(e) { showToast('Erro ao sincronizar: ' + (e.message || 'falha'), 'err'); }
}

// ── Toast ────────────────────────────
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  setTimeout(() => { el.className = 'toast'; }, 3000);
}
</script>
</body>
</html>`;

// ========================
// HTML das Configurações (Profile, Automation, QR Codes)
// ========================
export const SETTINGS_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Configurações - WhatsApp</title>
<style>
:root{--bg:#0b0d17;--card:#111827;--border:#1f2937;--accent:#25D366;--accent2:#128C7E;--red:#ef4444;--orange:#f59e0b;--blue:#3b82f6;--text:#e5e7eb;--muted:#6b7280;--input-bg:#1f2937}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
a{color:var(--accent);text-decoration:none}

.login-wrap{display:flex;justify-content:center;align-items:center;height:100vh}
.login-box{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:40px;width:360px;text-align:center}
.login-box h1{color:var(--accent);font-size:1.5rem;margin-bottom:8px}
.login-box p{color:var(--muted);font-size:.85rem;margin-bottom:24px}
.login-box input{width:100%;padding:12px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.95rem;margin-bottom:12px;outline:none}
.login-box input:focus{border-color:var(--accent)}
.login-box button{width:100%;padding:12px;background:var(--accent);color:#000;font-weight:700;border:none;border-radius:8px;font-size:1rem;cursor:pointer}
.login-box button:hover{background:var(--accent2)}
.login-box .err{color:var(--red);font-size:.85rem;margin-top:8px;min-height:20px}

.settings-app{max-width:960px;margin:0 auto;padding:20px}
.top-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--border)}
.top-bar h1{font-size:1.3rem;color:var(--accent);display:flex;align-items:center;gap:8px}
.top-bar .links{display:flex;gap:8px}
.top-bar .links a{padding:6px 14px;border:1px solid var(--border);border-radius:6px;font-size:.85rem;color:var(--muted)}
.top-bar .links a:hover{color:var(--accent);border-color:var(--accent)}

.section{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:20px}
.section h2{font-size:1.1rem;margin-bottom:4px;display:flex;align-items:center;gap:8px}
.section .desc{color:var(--muted);font-size:.82rem;margin-bottom:16px}

.form-row{display:flex;flex-direction:column;gap:4px;margin-bottom:14px}
.form-row label{font-size:.82rem;color:var(--muted);font-weight:600}
.form-row input,.form-row textarea,.form-row select{width:100%;padding:10px 14px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.9rem;font-family:inherit;outline:none}
.form-row input:focus,.form-row textarea:focus,.form-row select:focus{border-color:var(--accent)}
.form-row textarea{resize:vertical;min-height:60px}
.form-row .hint{font-size:.72rem;color:var(--muted)}

.form-actions{display:flex;gap:10px;margin-top:16px}
.btn{padding:10px 20px;border:none;border-radius:8px;font-weight:700;font-size:.9rem;cursor:pointer}
.btn-primary{background:var(--accent);color:#000}
.btn-primary:hover{background:var(--accent2)}
.btn-secondary{background:var(--input-bg);border:1px solid var(--border);color:var(--text)}
.btn-secondary:hover{border-color:var(--accent)}
.btn-danger{background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.3)}
.btn-danger:hover{background:rgba(239,68,68,.25)}

.toggle-row{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.toggle{width:44px;height:24px;border-radius:12px;background:var(--input-bg);border:1px solid var(--border);cursor:pointer;position:relative;transition:.2s}
.toggle.on{background:var(--accent);border-color:var(--accent)}
.toggle::after{content:'';position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:2px;left:2px;transition:.2s}
.toggle.on::after{left:22px}

.prompt-list{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}
.prompt-item{display:flex;gap:8px;align-items:center}
.prompt-item input{flex:1}
.prompt-item button{background:var(--input-bg);border:1px solid var(--border);color:var(--red);padding:6px 10px;border-radius:6px;cursor:pointer;font-size:.8rem}

.qr-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:16px}
.qr-card{background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center}
.qr-card img{max-width:200px;margin:12px auto;display:block;border-radius:8px;background:#fff;padding:8px}
.qr-card .msg{font-size:.85rem;color:var(--text);margin-bottom:8px;word-break:break-word}
.qr-card .code{font-size:.72rem;color:var(--muted);margin-bottom:8px}

.toast{position:fixed;bottom:20px;right:20px;padding:10px 20px;border-radius:8px;font-size:.85rem;z-index:100;animation:fadeInUp .3s;display:none}
.toast.ok{display:block;background:rgba(37,211,102,.15);color:var(--accent);border:1px solid rgba(37,211,102,.3)}
.toast.err{display:block;background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.3)}
@keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

.loading{text-align:center;padding:20px;color:var(--muted)}
</style>
</head>
<body>

<!-- LOGIN -->
<div class="login-wrap" id="loginPage">
  <div class="login-box">
    <h1>⚙️ Configurações</h1>
    <p>WhatsApp Business</p>
    <input type="text" id="loginUser" placeholder="Usuário" autocomplete="username">
    <input type="password" id="loginPass" placeholder="Senha" autocomplete="current-password">
    <button onclick="doLogin()">Entrar</button>
    <div class="err" id="loginErr"></div>
  </div>
</div>

<!-- SETTINGS -->
<div class="settings-app" id="settingsApp" style="display:none">
  <div class="top-bar">
    <h1>⚙️ Configurações</h1>
    <div class="links">
      <a href="/panel">📊 Painel</a>
      <a href="/panel/chat">💬 Chat</a>
    </div>
  </div>

  <!-- BUSINESS PROFILE -->
  <div class="section" id="profileSection">
    <h2>🏪 Perfil Comercial</h2>
    <div class="desc">Atualize as informações do perfil da sua empresa no WhatsApp</div>
    <div id="profileLoading" class="loading">Carregando perfil...</div>
    <div id="profileForm" style="display:none">
      <div class="form-row"><label>Sobre (About)</label><input id="profAbout" maxlength="139"><div class="hint">Texto curto exibido no perfil (máx 139 caracteres)</div></div>
      <div class="form-row"><label>Descrição</label><textarea id="profDesc" rows="3" maxlength="512"></textarea></div>
      <div class="form-row"><label>Endereço</label><input id="profAddress"></div>
      <div class="form-row"><label>Email</label><input id="profEmail" type="email"></div>
      <div class="form-row"><label>Website</label><input id="profWebsite" placeholder="https://..."></div>
      <div class="form-row"><label>Setor</label>
        <select id="profVertical">
          <option value="PROF_SERVICES">Serviços Profissionais</option>
          <option value="RETAIL">Varejo</option>
          <option value="AUTO">Automotivo</option>
          <option value="BEAUTY">Beleza</option>
          <option value="EDU">Educação</option>
          <option value="HEALTH">Saúde</option>
          <option value="RESTAURANT">Restaurante</option>
          <option value="ENTERTAIN">Entretenimento</option>
          <option value="TRAVEL">Viagem</option>
          <option value="OTHER">Outro</option>
        </select>
      </div>
      <div class="form-actions"><button class="btn btn-primary" onclick="saveProfile()">💾 Salvar Perfil</button></div>
    </div>
  </div>

  <!-- CONVERSATIONAL AUTOMATION -->
  <div class="section" id="automationSection">
    <h2>🤖 Automação de Conversas</h2>
    <div class="desc">Configure mensagem de boas-vindas e sugestões rápidas para os clientes</div>
    <div id="automationLoading" class="loading">Carregando configuração...</div>
    <div id="automationForm" style="display:none">
      <div class="toggle-row">
        <div class="toggle" id="welcomeToggle" onclick="toggleWelcome()"></div>
        <label>Mensagem de boas-vindas ativada</label>
      </div>
      <div class="form-row"><label>Prompts (Ice Breakers) — máx. 3 sugestões que aparecem para o cliente</label></div>
      <div class="prompt-list" id="promptList"></div>
      <button class="btn btn-secondary" onclick="addPrompt()" id="addPromptBtn" style="margin-bottom:14px">+ Adicionar sugestão</button>
      <div class="form-row"><label>Comandos do Bot (até 30)</label></div>
      <div class="prompt-list" id="cmdList"></div>
      <button class="btn btn-secondary" onclick="addCmd()" style="margin-bottom:14px">+ Adicionar comando</button>
      <div class="form-actions"><button class="btn btn-primary" onclick="saveAutomation()">💾 Salvar Automação</button></div>
    </div>
  </div>

  <!-- QR CODES -->
  <div class="section" id="qrSection">
    <h2>📱 QR Codes</h2>
    <div class="desc">Gere QR codes para que clientes iniciem conversa no WhatsApp com mensagem pré-preenchida</div>
    <div style="display:flex;gap:8px;align-items:flex-end">
      <div class="form-row" style="flex:1;margin-bottom:0"><label>Mensagem pré-preenchida</label><input id="qrMessage" placeholder="Olá! Vi o QR code na loja e gostaria de..."></div>
      <button class="btn btn-primary" onclick="createQR()" style="height:42px;white-space:nowrap">📱 Gerar QR</button>
    </div>
    <div id="qrLoading" class="loading" style="display:none">Carregando QR codes...</div>
    <div class="qr-list" id="qrList"></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
let TOKEN = localStorage.getItem('wa_token') || '';
const API = '/panel/api';

// ── Auth ─────────────────────────────
async function doLogin() {
  const user = document.getElementById('loginUser').value;
  const pass = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginErr');
  try {
    const r = await fetch(API + '/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({user, pass}) });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'Erro'; return; }
    TOKEN = d.token; localStorage.setItem('wa_token', TOKEN);
    showSettings();
  } catch(e) { errEl.textContent = 'Erro de conexão'; }
}

function showSettings() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('settingsApp').style.display = 'block';
  loadProfile();
  loadAutomation();
  loadQRCodes();
}

if (TOKEN) {
  fetch(API + '/dashboard-stats', { headers: { Authorization: 'Bearer ' + TOKEN } })
    .then(r => { if (r.ok) showSettings(); else { TOKEN = ''; localStorage.removeItem('wa_token'); } })
    .catch(() => {});
}

document.getElementById('loginPass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function api(path) {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (r.status === 401) { TOKEN = ''; localStorage.removeItem('wa_token'); location.reload(); }
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) { TOKEN = ''; localStorage.removeItem('wa_token'); location.reload(); }
  return r.json();
}
async function apiDelete(path) {
  const r = await fetch(API + path, { method: 'DELETE', headers: { Authorization: 'Bearer ' + TOKEN } });
  if (r.status === 401) { TOKEN = ''; localStorage.removeItem('wa_token'); location.reload(); }
  return r.json();
}
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ── Business Profile ─────────────────
async function loadProfile() {
  try {
    const data = await api('/business-profile');
    document.getElementById('profAbout').value = data.about || '';
    document.getElementById('profDesc').value = data.description || '';
    document.getElementById('profAddress').value = data.address || '';
    document.getElementById('profEmail').value = data.email || '';
    document.getElementById('profWebsite').value = (data.websites || [])[0] || '';
    if (data.vertical) document.getElementById('profVertical').value = data.vertical;
    document.getElementById('profileLoading').style.display = 'none';
    document.getElementById('profileForm').style.display = 'block';
  } catch(e) {
    document.getElementById('profileLoading').textContent = 'Erro ao carregar perfil: ' + (e.message || '');
  }
}

async function saveProfile() {
  const payload = {
    about: document.getElementById('profAbout').value.trim(),
    description: document.getElementById('profDesc').value.trim(),
    address: document.getElementById('profAddress').value.trim(),
    email: document.getElementById('profEmail').value.trim(),
    vertical: document.getElementById('profVertical').value,
  };
  const web = document.getElementById('profWebsite').value.trim();
  if (web) payload.websites = [web];
  try {
    const res = await apiPost('/business-profile', payload);
    if (res.error) throw new Error(res.error);
    showToast('Perfil atualizado com sucesso!', 'ok');
  } catch(e) { showToast('Erro: ' + (e.message || 'falha'), 'err'); }
}

// ── Conversational Automation ────────
let welcomeEnabled = false;
let prompts = [];
let commands = [];

async function loadAutomation() {
  try {
    const data = await api('/conversational-automation');
    if (data.error) throw new Error(data.error);
    welcomeEnabled = !!data.enable_welcome_message;
    prompts = data.prompts || [];
    commands = (data.commands || []).map(c => ({name: c.command_name || '', desc: c.command_description || ''}));
    renderAutomation();
    document.getElementById('automationLoading').style.display = 'none';
    document.getElementById('automationForm').style.display = 'block';
  } catch(e) {
    const msg = e.message || '';
    if (msg.includes('nonexisting field') || msg.includes('not supported')) {
      document.getElementById('automationLoading').innerHTML = '<div style="color:var(--orange)">⚠️ Este recurso ainda não está disponível para sua conta. A Meta está liberando gradualmente.<br><small style="color:var(--muted)">Verifique em <a href="https://business.facebook.com" target="_blank">Meta Business Suite</a> se o recurso foi habilitado.</small></div>';
    } else {
      document.getElementById('automationLoading').textContent = 'Erro ao carregar: ' + msg;
    }
  }
}

function renderAutomation() {
  const toggle = document.getElementById('welcomeToggle');
  toggle.className = 'toggle' + (welcomeEnabled ? ' on' : '');
  renderPrompts();
  renderCmds();
}

function toggleWelcome() {
  welcomeEnabled = !welcomeEnabled;
  document.getElementById('welcomeToggle').className = 'toggle' + (welcomeEnabled ? ' on' : '');
}

function renderPrompts() {
  const el = document.getElementById('promptList');
  const btn = document.getElementById('addPromptBtn');
  btn.style.display = prompts.length >= 3 ? 'none' : '';
  el.innerHTML = prompts.map((p, i) =>
    '<div class="prompt-item"><input value="' + esc(p) + '" maxlength="80" onchange="prompts[' + i + ']=this.value" placeholder="Ex: Como posso ajudar?"><button onclick="prompts.splice(' + i + ',1);renderPrompts()">✕</button></div>'
  ).join('');
}
function addPrompt() { if (prompts.length < 3) { prompts.push(''); renderPrompts(); } }

function renderCmds() {
  const el = document.getElementById('cmdList');
  el.innerHTML = commands.map((c, i) =>
    '<div class="prompt-item"><input value="' + esc(c.name) + '" placeholder="comando" style="max-width:120px" onchange="commands[' + i + '].name=this.value">' +
    '<input value="' + esc(c.desc) + '" placeholder="Descrição do comando" onchange="commands[' + i + '].desc=this.value">' +
    '<button onclick="commands.splice(' + i + ',1);renderCmds()">✕</button></div>'
  ).join('');
}
function addCmd() { commands.push({name:'',desc:''}); renderCmds(); }

async function saveAutomation() {
  const payload = {
    enable_welcome_message: welcomeEnabled,
    prompts: prompts.filter(p => p.trim()),
    commands: commands.filter(c => c.name.trim()).map(c => ({ command_name: c.name.trim(), command_description: c.desc.trim() }))
  };
  try {
    const res = await apiPost('/conversational-automation', payload);
    if (res.error) throw new Error(res.error);
    showToast('Automação salva com sucesso!', 'ok');
  } catch(e) { showToast('Erro: ' + (e.message || 'falha'), 'err'); }
}

// ── QR Codes ─────────────────────────
let qrcodes = [];

async function loadQRCodes() {
  document.getElementById('qrLoading').style.display = 'block';
  try {
    const data = await api('/qrcodes');
    qrcodes = Array.isArray(data) ? data : (data?.data || []);
    renderQRCodes();
  } catch(e) { console.error('QR load error:', e); }
  document.getElementById('qrLoading').style.display = 'none';
}

function renderQRCodes() {
  const el = document.getElementById('qrList');
  if (!qrcodes.length) { el.innerHTML = '<div style="color:var(--muted);padding:12px">Nenhum QR code criado ainda</div>'; return; }
  el.innerHTML = qrcodes.map(q => {
    const img = q.qr_image_url ? '<img src="' + esc(q.qr_image_url) + '" alt="QR Code">' : '<div style="padding:20px;color:var(--muted)">Sem imagem</div>';
    return '<div class="qr-card">' + img +
      '<div class="msg">"' + esc(q.prefilled_message || '') + '"</div>' +
      '<div class="code">Código: ' + esc(q.code || q.id || '') + '</div>' +
      (q.deep_link_url ? '<div class="code"><a href="' + esc(q.deep_link_url) + '" target="_blank">🔗 Link direto</a></div>' : '') +
      '<button class="btn btn-danger" onclick="deleteQR(\\'' + esc(q.code || q.id || '') + '\\')">🗑 Excluir</button></div>';
  }).join('');
}

async function createQR() {
  const msg = document.getElementById('qrMessage').value.trim();
  if (!msg) { showToast('Digite uma mensagem', 'err'); return; }
  try {
    const res = await apiPost('/qrcodes', { message: msg, format: 'PNG' });
    if (res.error) throw new Error(res.error);
    document.getElementById('qrMessage').value = '';
    showToast('QR Code criado!', 'ok');
    await loadQRCodes();
  } catch(e) { showToast('Erro: ' + (e.message || 'falha'), 'err'); }
}

async function deleteQR(code) {
  if (!confirm('Excluir este QR code?')) return;
  try {
    await apiDelete('/qrcodes/' + encodeURIComponent(code));
    showToast('QR code excluído', 'ok');
    await loadQRCodes();
  } catch(e) { showToast('Erro: ' + (e.message || 'falha'), 'err'); }
}

// ── Toast ────────────────────────────
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  setTimeout(() => { el.className = 'toast'; }, 3000);
}
</script>
</body>
</html>`;