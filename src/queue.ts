import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config";
import { whatsappApi, SendTemplatePayload } from "./whatsapp-api";
import { warmupManager } from "./warmup";
import { logger } from "./logger";
import db from "./database";

// ========================
// Delays humanizados para evitar detecção de robô
// ========================

/**
 * Gera um delay aleatório seguindo distribuição que simula comportamento humano.
 * - Base: intervalo aleatório entre min e max
 * - Jitter: variação gaussiana para parecer natural
 * - Pausas longas: chance de "ler/pensar" com pausa maior
 */
function humanDelay(index: number): number {
  const min = config.WARMUP_MIN_INTERVAL;  // 8s default
  const max = config.WARMUP_MAX_INTERVAL;  // 25s default

  // Base aleatória uniforme entre min e max
  const base = min + Math.random() * (max - min);

  // Jitter gaussiano (Box-Muller) — ±20% variação
  const u1 = Math.random();
  const u2 = Math.random();
  const gaussian = Math.sqrt(-2 * Math.log(u1 || 0.001)) * Math.cos(2 * Math.PI * u2);
  const jitter = base * 0.2 * gaussian;

  // Fadiga: +5% por cada 10 mensagens (simula cansaço humano)
  const fatigueFactor = 1 + Math.floor(index / 10) * 0.05;

  let delay = Math.max(min, (base + jitter) * fatigueFactor);

  // Chance de pausa longa ("lendo mensagem", "fazendo outra coisa")
  if (Math.random() < config.WARMUP_LONG_PAUSE_CHANCE) {
    const longPause = min + Math.random() * (config.WARMUP_LONG_PAUSE_MAX - min);
    delay += longPause;
  }

  return Math.round(delay);
}

/**
 * Gera uma sequência de delays acumulados para N mensagens.
 * Retorna array onde cada posição é o delay total desde o início.
 */
function generateCumulativeDelays(count: number): number[] {
  const delays: number[] = [];
  let cumulative = 0;
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      // Primeira mensagem: delay curto (1-3s) para iniciar rápido
      cumulative += 1000 + Math.random() * 2000;
    } else {
      cumulative += humanDelay(i);
    }
    delays.push(Math.round(cumulative));
  }
  return delays;
}

const connection = new IORedis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => {
    if (times > 10) {
      logger.error("Redis: máximo de tentativas de reconexão atingido");
      return null; // Para de tentar
    }
    const delay = Math.min(times * 1000, 30_000);
    logger.warn(`Redis: reconectando em ${delay / 1000}s (tentativa ${times})`);
    return delay;
  },
  reconnectOnError: (err) => {
    const targetError = "READONLY";
    if (err.message.includes(targetError)) return true;
    return false;
  },
});

connection.on("connect", () => {
  logger.info("Redis: conectado");
});

connection.on("error", (err) => {
  logger.error(`Redis: erro de conexão - ${err.message}`);
});

// Fila principal de mensagens
export const messageQueue = new Queue("whatsapp-messages", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export interface MessageJob {
  phone: string;
  templateName: string;
  category: "marketing" | "utility" | "authentication";
  languageCode?: string;
  params?: string[];
  campaignId?: string;
}

/**
 * Adicionar contatos à fila de disparo
 */
export async function enqueueBulkMessages(
  contacts: Array<{ phone: string; name?: string; params?: string[] }>,
  templateName: string,
  category: "marketing" | "utility" | "authentication",
  campaignId?: string,
  languageCode?: string
): Promise<{ enqueued: number }> {
  // Gerar delays humanizados — cada mensagem com timing diferente
  const delays = generateCumulativeDelays(contacts.length);

  const jobs = contacts.map((contact, index) => ({
    name: `send-${templateName}-${Date.now()}-${index}`,
    data: {
      phone: contact.phone,
      templateName,
      category,
      languageCode,
      params: contact.params,
      campaignId,
    } as MessageJob,
    opts: {
      delay: delays[index],
      priority: category === "utility" ? 1 : category === "authentication" ? 0 : 2,
    },
  }));

  await messageQueue.addBulk(jobs);

  const totalTime = delays.length > 0 ? delays[delays.length - 1] : 0;
  const avgDelay = contacts.length > 1 ? Math.round(totalTime / contacts.length / 1000) : 0;
  logger.info(`${jobs.length} mensagens enfileiradas (tempo total ≈ ${Math.round(totalTime / 1000)}s, média ${avgDelay}s/msg)`, {
    templateName, category, campaignId,
  });

  return { enqueued: jobs.length };
}

/**
 * Worker que processa a fila respeitando o warm-up
 */
export function startWorker(): Worker {
  const worker = new Worker<MessageJob>(
    "whatsapp-messages",
    async (job: Job<MessageJob>) => {
      const { phone, templateName, category, params, languageCode } = job.data;

      // Checar limite diário
      if (!warmupManager.canSendMore()) {
        // Re-enfileirar para o próximo dia
        const msUntilMidnight = getMsUntilMidnight();
        await messageQueue.add(job.name!, job.data, {
          delay: msUntilMidnight,
        });
        logger.info(`Limite diário atingido. Mensagem para ${phone} reagendada para amanhã.`);
        return { status: "rescheduled" };
      }

      const components = params
        ? [{ type: "body" as const, parameters: params.map((p) => ({ type: "text" as const, text: p })) }]
        : undefined;

      const payload: SendTemplatePayload = {
        to: phone,
        templateName,
        languageCode,
        components,
      };

      // Micro-delay humanizado antes do envio real (2-6s) — simula "digitando"
      const preDelay = 2000 + Math.random() * 4000;
      await new Promise((resolve) => setTimeout(resolve, preDelay));

      const response = await whatsappApi.sendTemplate(payload);
      const wamid = response.messages?.[0]?.id;

      // Auto-cadastrar contato se não existir (evita FK violation)
      db.prepare(
        `INSERT OR IGNORE INTO contacts (phone, name, opted_in) VALUES (?, ?, 1)`
      ).run(phone, phone);

      db.prepare(
        `INSERT OR REPLACE INTO messages (wamid, contact_phone, template_name, category, status, sent_at)
         VALUES (?, ?, ?, ?, 'sent', datetime('now','localtime'))`
      ).run(wamid, phone, templateName, category);

      // Registrar no warmup manager
      warmupManager.recordSent();

      return { status: "sent", wamid };
    },
    {
      connection,
      concurrency: 1, // Uma mensagem por vez — fundamental para controle
      // Sem limiter fixo do BullMQ — os delays humanizados já controlam o ritmo
      // O limiter fixo criaria padrão regular detectável
    }
  );

  worker.on("completed", (job) => {
    logger.info(`Job ${job.id} completado para ${job.data.phone}`);
  });

  worker.on("failed", (job, err) => {
    if (job) {
      logger.error(`Job ${job.id} falhou para ${job.data.phone}: ${err.message}`);
      try {
        db.prepare(
          `INSERT INTO messages (contact_phone, template_name, category, status, error_message)
           VALUES (?, ?, ?, 'failed', ?)`
        ).run(job.data.phone, job.data.templateName, job.data.category, err.message);
      } catch {
        logger.warn(`Não foi possível gravar falha no DB para ${job.data.phone} (contato não cadastrado)`);
      }
    }
  });

  logger.info("Worker de mensagens iniciado");
  return worker;
}

function getMsUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}
