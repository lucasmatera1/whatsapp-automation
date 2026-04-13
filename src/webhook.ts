import express from "express";
import crypto from "crypto";
import { config } from "./config";
import { logger } from "./logger";
import { whatsappApi } from "./whatsapp-api";
import { textToAudio, prepareTextForTTS } from "./tts";
import { generateReply } from "./conversation-engine";
import db from "./database";

// ============================================================
// Event emitter para live feed (SSE)
// ============================================================
type LiveListener = (event: LiveEvent) => void;
export interface LiveEvent {
  type: "incoming" | "auto_reply" | "status" | "opt_out";
  timestamp: string;
  phone: string;
  name: string;
  text: string;
  extra?: string;
}

const listeners: Set<LiveListener> = new Set();

export function onLiveEvent(fn: LiveListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emitLive(event: LiveEvent): void {
  for (const fn of listeners) {
    try { fn(event); } catch { /* ignore */ }
  }
}

export function createWebhookRouter(): express.Router {
  const router = express.Router();

  // Verificação do webhook (GET) - Meta envia isso para validar o endpoint
  router.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === config.VERIFY_TOKEN) {
      logger.info("Webhook verificado com sucesso");
      return res.status(200).send(challenge);
    }

    logger.warn("Falha na verificação do webhook", { mode, token });
    return res.sendStatus(403);
  });

  // Receber eventos do webhook (POST)
  router.post("/webhook", (req, res) => {
    // Validar assinatura do payload
    const signature = req.headers["x-hub-signature-256"] as string;
    const rawBody = (req as any).rawBody;
    if (!verifySignature(rawBody, signature)) {
      logger.warn("Assinatura inválida no webhook");
      return res.sendStatus(401);
    }

    // Responder 200 imediatamente (Meta exige resposta rápida)
    res.sendStatus(200);

    try {
      const body = req.body;

      if (body.object !== "whatsapp_business_account") return;

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;

          // Status updates (sent, delivered, read, failed)
          if (value.statuses) {
            for (const status of value.statuses) {
              handleStatusUpdate(status);
            }
          }

          // Incoming messages
          if (value.messages) {
            for (const message of value.messages) {
              handleIncomingMessage(message, value.contacts?.[0]);
            }
          }
        }
      }
    } catch (error: any) {
      logger.error("Erro ao processar webhook", { error: error.message });
    }
  });

  return router;
}

function verifySignature(rawBody: Buffer | string | undefined, signature: string | undefined): boolean {
  if (!signature || !rawBody) return false;

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const expectedSignature =
    "sha256=" +
    crypto
      .createHmac("sha256", config.APP_SECRET)
      .update(bodyBuffer)
      .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

function handleStatusUpdate(status: any): void {
  const { id: wamid, status: msgStatus, timestamp, errors } = status;

  logger.info(`Status update: ${wamid} -> ${msgStatus}`);

  const updates: Record<string, string> = {
    sent: "sent",
    delivered: "delivered",
    read: "read",
    failed: "failed",
  };

  const newStatus = updates[msgStatus];
  if (!newStatus) return;

  if (msgStatus === "failed") {
    const errorMsg = errors?.[0]?.title || "Unknown error";
    db.prepare(
      "UPDATE messages SET status = ?, error_message = ? WHERE wamid = ?"
    ).run(newStatus, errorMsg, wamid);
    logger.error(`Mensagem ${wamid} falhou: ${errorMsg}`);
  } else {
    const dateField =
      msgStatus === "delivered" ? "delivered_at" : msgStatus === "read" ? "read_at" : null;

    if (dateField) {
      db.prepare(
        `UPDATE messages SET status = ?, ${dateField} = datetime('now','localtime') WHERE wamid = ?`
      ).run(newStatus, wamid);
    } else {
      db.prepare("UPDATE messages SET status = ? WHERE wamid = ?").run(newStatus, wamid);
    }
  }

  // Salvar evento raw
  db.prepare("INSERT INTO webhook_events (event_type, payload) VALUES (?, ?)").run(
    `status_${msgStatus}`,
    JSON.stringify(status)
  );
}

function handleIncomingMessage(message: any, contact: any): void {
  const phone = message.from;
  const messageType = message.type;
  // Extrair texto: texto normal, botão interativo, ou tipo de mídia
  let text = message.text?.body || "";
  let buttonPayload = "";
  if (messageType === "interactive" && message.interactive?.type === "button_reply") {
    text = message.interactive.button_reply.title || "";
    buttonPayload = message.interactive.button_reply.id || "";
  }
  const contactName = contact?.profile?.name || "";

  logger.info(`Mensagem recebida de ${phone} (${contactName}): ${text}`);

  // Emitir evento para live feed
  emitLive({
    type: "incoming",
    timestamp: new Date().toISOString(),
    phone,
    name: contactName,
    text: text || `[${messageType}]`,
  });

  // Marcar como lida (✓✓ azul)
  whatsappApi.markAsRead(message.id).catch((err: any) => {
    logger.warn(`Falha ao marcar como lida: ${err.message}`);
  });

  // Upsert contato
  db.prepare(
    `INSERT INTO contacts (phone, name, opted_in, opted_in_at)
     VALUES (?, ?, 1, datetime('now','localtime'))
     ON CONFLICT(phone) DO UPDATE SET name = ?, updated_at = datetime('now','localtime')`
  ).run(phone, contactName, contactName);

  // Processar opt-out (detecção ampla) — inclui botões "Não, obrigado" e texto livre
  const isOptOutButton = buttonPayload.toLowerCase().includes("opt_out") ||
    (messageType === "interactive" && /\bn[aã]o\b/i.test(text));
  const optOutPatterns = [
    /\b(me tir[ae]|tira (eu|meu)|remove|me remov[ae]|me exclu[ií]|me delet[ae])\b/i,
    /\b(sair|quero sair|não quero mais|nao quero mais|para de|pare de|parar de)\b.*\b(receber|mandar|enviar|mensag|lista|grupo|notificaç|notificac)\b/i,
    /\b(me tira|me tire|tira eu|me remove|me remova|me exclui|me exclua|sai dessa|sair dessa)\b/i,
    /\b(não me mand[ae]|nao me mand[ae]|não envi[ae]|nao envi[ae])\b.*\b(mais|nada|mensag)\b/i,
    /\b(descadastrar|descadastra|opt.?out|unsubscribe|parar|stop|cancelar)\b/i,
  ];
  if (isOptOutButton || optOutPatterns.some((rx) => rx.test(text))) {
    db.prepare(
      "UPDATE contacts SET opted_out = 1, opted_out_at = datetime('now','localtime') WHERE phone = ?"
    ).run(phone);
    logger.info(`Contato ${phone} fez opt-out`);

    emitLive({
      type: "opt_out",
      timestamp: new Date().toISOString(),
      phone,
      name: contactName,
      text: "Fez opt-out",
    });

    // Confirmar opt-out
    whatsappApi.sendText({
      to: phone,
      body: "Pronto! Você não receberá mais mensagens. Se mudar de ideia, é só mandar um Oi. 👋",
    }).catch((err: any) => {
      logger.warn(`Falha ao confirmar opt-out para ${phone}: ${err.message}`);
    });
  } else if (messageType === "interactive" && /\bsim\b/i.test(text)) {
    // Botão positivo ("Sim, quero saber!") — tratar como interesse
    logger.info(`Contato ${phone} clicou botão positivo: "${text}"`);
    autoReply(phone, contactName, "Sim, quero saber mais!");
  } else {
    // Auto-responder com variação
    autoReply(phone, contactName, text);
  }

  // Salvar evento
  db.prepare("INSERT INTO webhook_events (event_type, payload) VALUES (?, ?)").run(
    "incoming_message",
    JSON.stringify({ phone, type: messageType, text, contact: contactName })
  );
}

// ============================================================
// Auto-responder inteligente via ConversationEngine
// ============================================================

// Debounce: acumula mensagens rápidas e responde ao conjunto
const PENDING_MESSAGES = new Map<string, { texts: string[]; name: string; timer: ReturnType<typeof setTimeout> }>();
const DEBOUNCE_MS = 8_000;   // espera 8s após última msg para responder
const MIN_GAP_MS  = 30_000;  // mínimo 30s entre respostas para o mesmo número
const LAST_REPLY  = new Map<string, number>();

function autoReply(phone: string, name: string, incomingText: string): void {
  const pending = PENDING_MESSAGES.get(phone);

  if (pending) {
    // Já tem mensagens pendentes — acumula e reseta o timer
    pending.texts.push(incomingText);
    pending.name = name;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => flushReply(phone), DEBOUNCE_MS);
    logger.info(`Debounce: acumulando msg de ${phone} (${pending.texts.length} msgs pendentes)`);
  } else {
    // Primeira msg — checa min gap
    const lastReply = LAST_REPLY.get(phone) || 0;
    const elapsed = Date.now() - lastReply;

    if (elapsed < MIN_GAP_MS) {
      // Dentro do gap mínimo — agenda para quando o gap completar + debounce
      const waitMs = (MIN_GAP_MS - elapsed) + DEBOUNCE_MS;
      const entry = {
        texts: [incomingText],
        name,
        timer: setTimeout(() => flushReply(phone), waitMs),
      };
      PENDING_MESSAGES.set(phone, entry);
      logger.info(`Debounce: msg de ${phone} agendada (gap restante ${Math.round((MIN_GAP_MS - elapsed) / 1000)}s + ${DEBOUNCE_MS / 1000}s)`);
    } else {
      // Fora do gap — inicia debounce normal
      const entry = {
        texts: [incomingText],
        name,
        timer: setTimeout(() => flushReply(phone), DEBOUNCE_MS),
      };
      PENDING_MESSAGES.set(phone, entry);
    }
  }
}

function flushReply(phone: string): void {
  const pending = PENDING_MESSAGES.get(phone);
  if (!pending) return;
  PENDING_MESSAGES.delete(phone);

  const { texts, name } = pending;
  const firstName = name.split(" ")[0] || "";

  // Combina todas as mensagens acumuladas para o conversation engine
  const combinedText = texts.length === 1 ? texts[0] : texts.join("\n");

  // Alimenta o context com cada mensagem individual
  // (a última chamada de generateReply vai considerar todo o histórico)
  let reply = "";
  for (const t of texts) {
    const r = generateReply(phone, name, t);
    reply = r.text;
  }

  // Se o conversation engine detectou opt-out, processar aqui
  if (reply === "__OPT_OUT__") {
    db.prepare(
      "UPDATE contacts SET opted_out = 1, opted_out_at = datetime('now','localtime') WHERE phone = ?"
    ).run(phone);
    logger.info(`Contato ${phone} (${name}) fez opt-out via conversation engine`);

    emitLive({
      type: "opt_out",
      timestamp: new Date().toISOString(),
      phone,
      name: firstName,
      text: "Fez opt-out",
    });

    whatsappApi.sendText({
      to: phone,
      body: "Pronto! Você não receberá mais mensagens. Se mudar de ideia, é só mandar um Oi. 👋",
    }).catch((err: any) => {
      logger.warn(`Falha ao confirmar opt-out para ${phone}: ${err.message}`);
    });
    return;
  }

  // ~30% chance de enviar como áudio (simula humano real)
  const sendAsAudio = Math.random() < 0.30;

  // Delay humanizado: 2-5s
  const delay = Math.floor(Math.random() * 3000) + 2000;

  setTimeout(async () => {
    try {
      if (sendAsAudio) {
        const audioText = prepareTextForTTS(reply);
        const audioBuffer = await textToAudio(audioText);
        const mediaId = await whatsappApi.uploadMedia(audioBuffer, "audio/mpeg", "audio.mp3");
        const res = await whatsappApi.sendAudio(phone, mediaId);
        const wamid = res.messages?.[0]?.id;

        if (wamid) {
          db.prepare(
            "INSERT OR IGNORE INTO messages (wamid, contact_phone, template_name, body, category, status, sent_at, created_at) VALUES (?, ?, 'auto_reply', ?, 'utility', 'sent', datetime('now','localtime'), datetime('now','localtime'))"
          ).run(wamid, phone, reply);
        }

        LAST_REPLY.set(phone, Date.now());
        logger.info(`Auto-reply ÁUDIO enviado para ${phone}: "${audioText.substring(0, 50)}..."`);
        emitLive({
          type: "auto_reply",
          timestamp: new Date().toISOString(),
          phone,
          name: firstName,
          text: `🎤 ${reply}`,
        });
      } else {
        const res = await whatsappApi.sendText({ to: phone, body: reply });
        const wamid = res.messages?.[0]?.id;

        if (wamid) {
          db.prepare(
            "INSERT OR IGNORE INTO messages (wamid, contact_phone, template_name, body, category, status, sent_at, created_at) VALUES (?, ?, 'auto_reply', ?, 'utility', 'sent', datetime('now','localtime'), datetime('now','localtime'))"
          ).run(wamid, phone, reply);
        }

        LAST_REPLY.set(phone, Date.now());
        logger.info(`Auto-reply TEXTO enviado para ${phone}: "${reply.substring(0, 50)}..."`);
        emitLive({
          type: "auto_reply",
          timestamp: new Date().toISOString(),
          phone,
          name: firstName,
          text: reply,
        });
      }
    } catch (err: any) {
      logger.warn(`Falha no auto-reply para ${phone}: ${err.message}`);
      if (sendAsAudio) {
        try {
          const res = await whatsappApi.sendText({ to: phone, body: reply });
          const wamid = res.messages?.[0]?.id;

          if (wamid) {
            db.prepare(
              "INSERT OR IGNORE INTO messages (wamid, contact_phone, template_name, body, category, status, sent_at, created_at) VALUES (?, ?, 'auto_reply', ?, 'utility', 'sent', datetime('now','localtime'), datetime('now','localtime'))"
            ).run(wamid, phone, reply);
          }

          LAST_REPLY.set(phone, Date.now());
          logger.info(`Fallback texto enviado para ${phone} após falha no áudio`);
        } catch (fallbackErr: any) {
          logger.warn(`Fallback texto também falhou para ${phone}: ${fallbackErr.message}`);
        }
      }
    }
  }, delay);
}
