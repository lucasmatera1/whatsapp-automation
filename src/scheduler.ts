import cron from "node-cron";
import { getContactsByTag } from "./contacts";
import { enqueueBulkMessages } from "./queue";
import { warmupManager } from "./warmup";
import { generateParams } from "./content-generator";
import { logger } from "./logger";
import db from "./database";

// ============================================================
// Agendador de Disparos Diários de Aquecimento
// Distribui envios em janelas ao longo do dia para parecer
// orgânico e maximizar volume sem parecer robótico.
// ============================================================

export interface ScheduleSlot {
  cronExpression: string;     // Cron expression (minuto hora * * *)
  templateName: string;
  languageCode: string;
  category: "utility" | "marketing";
  tag: string;                // Tag dos contatos a enviar
  description: string;
}

// Plano padrão: 4 janelas/dia × 9 contatos = ~36 msgs/dia
const DEFAULT_SCHEDULE: ScheduleSlot[] = [
  {
    cronExpression: "0 9 * * *",    // 09:00
    templateName: "notificacao_novidade",
    languageCode: "pt_BR",
    category: "utility",
    tag: "fase1",
    description: "Manhã — novidade do dia",
  },
  {
    cronExpression: "30 11 * * *",  // 11:30
    templateName: "pesquisa_satisfacao",
    languageCode: "pt_BR",
    category: "utility",
    tag: "fase1",
    description: "Meio-dia — pesquisa de satisfação",
  },
  {
    cronExpression: "30 14 * * *",  // 14:30
    templateName: "lembrete_retorno",
    languageCode: "pt_BR",
    category: "utility",
    tag: "fase1",
    description: "Tarde — lembrete de retorno",
  },
  {
    cronExpression: "0 17 * * *",   // 17:00
    templateName: "agradecimento_contato",
    languageCode: "pt_BR",
    category: "utility",
    tag: "fase1",
    description: "Final de tarde — agradecimento",
  },
];

let scheduledTasks: cron.ScheduledTask[] = [];

/**
 * Executa um slot de disparo: envia template para todos os contatos da tag.
 */
async function executeSlot(slot: ScheduleSlot): Promise<void> {
  logger.info(`⏰ Scheduler: executando slot "${slot.description}" (${slot.templateName})`);

  // Verificar qualidade antes de enviar
  const qualityCheck = await warmupManager.checkQualityForSending();
  if (!qualityCheck.canSend) {
    logger.warn(`Scheduler: envio bloqueado — ${qualityCheck.reason}`);
    return;
  }

  // Verificar limite diário
  if (!warmupManager.canSendMore()) {
    logger.warn(`Scheduler: limite diário atingido (${warmupManager.remainingToday()} restante)`);
    return;
  }

  // Buscar contatos ativos (exclui opt-out automaticamente)
  const contacts = getContactsByTag(slot.tag);
  if (contacts.length === 0) {
    logger.warn(`Scheduler: nenhum contato com tag "${slot.tag}"`);
    return;
  }

  // Filtrar quem já recebeu ESTE template hoje (evita duplicatas e frequency capping da Meta)
  const today = new Date().toLocaleDateString("en-CA");
  const alreadySent = db
    .prepare(
      `SELECT DISTINCT contact_phone FROM messages
       WHERE template_name = ? AND created_at >= ? AND status != 'failed'`
    )
    .all(slot.templateName, today + " 00:00:00") as Array<{ contact_phone: string }>;

  const sentPhones = new Set(alreadySent.map((r) => r.contact_phone));

  // Também filtrar quem teve "failed" por frequency capping nas últimas 4 horas
  const recentFailed = db
    .prepare(
      `SELECT DISTINCT contact_phone FROM messages
       WHERE status = 'failed' AND created_at >= datetime('now', '-4 hours')`
    )
    .all() as Array<{ contact_phone: string }>;

  for (const r of recentFailed) sentPhones.add(r.contact_phone);

  const filtered = contacts.filter((c) => !sentPhones.has(c.phone));

  if (filtered.length === 0) {
    logger.info(`Scheduler: todos os contatos já receberam "${slot.templateName}" hoje — pulando`);
    return;
  }

  logger.info(`Scheduler: ${filtered.length}/${contacts.length} contatos aptos (${sentPhones.size} já receberam/falharam)`);

  // Respeitar limite restante
  const remaining = warmupManager.remainingToday();
  const toSend = filtered.slice(0, remaining);

  // Gerar parâmetros variados para cada contato
  const contactPayloads = toSend.map((c) => {
    const params = generateParams(slot.templateName, c.name || c.phone);
    return {
      phone: c.phone,
      name: c.name,
      params: params.length > 0 ? params : undefined,
    };
  });

  try {
    const result = await enqueueBulkMessages(
      contactPayloads,
      slot.templateName,
      slot.category,
      `scheduler-${slot.templateName}-${new Date().toLocaleDateString("en-CA")}`,
      slot.languageCode
    );
    logger.info(`Scheduler: ${slot.description} — ${contactPayloads.length} mensagens enfileiradas`, result);
  } catch (error: any) {
    logger.error(`Scheduler: erro no slot "${slot.description}" — ${error.message}`);
  }
}

/**
 * Inicia o agendador com os slots definidos.
 * Cada slot vira um cron job que roda diariamente.
 */
export function startScheduler(customSchedule?: ScheduleSlot[]): void {
  const schedule = customSchedule || DEFAULT_SCHEDULE;

  // Limpar jobs anteriores se existirem
  stopScheduler();

  for (const slot of schedule) {
    if (!cron.validate(slot.cronExpression)) {
      logger.error(`Scheduler: cron inválido "${slot.cronExpression}" para "${slot.description}"`);
      continue;
    }

    const task = cron.schedule(slot.cronExpression, () => {
      executeSlot(slot).catch((err) => {
        logger.error(`Scheduler: erro não tratado no slot "${slot.description}" — ${err.message}`);
      });
    }, {
      timezone: "America/Sao_Paulo",
    });

    scheduledTasks.push(task);
    logger.info(`Scheduler: agendado "${slot.description}" → ${slot.cronExpression} (${slot.templateName})`);
  }

  logger.info(`✅ Scheduler ativo com ${scheduledTasks.length} slots diários`);
}

/**
 * Para todos os cron jobs agendados.
 */
export function stopScheduler(): void {
  for (const task of scheduledTasks) {
    task.stop();
  }
  if (scheduledTasks.length > 0) {
    logger.info(`Scheduler: ${scheduledTasks.length} jobs parados`);
  }
  scheduledTasks = [];
}

/**
 * Retorna info sobre os slots agendados.
 */
export function getScheduleInfo(): Array<{
  description: string;
  template: string;
  cron: string;
  tag: string;
}> {
  const schedule = DEFAULT_SCHEDULE;
  return schedule.map((s) => ({
    description: s.description,
    template: s.templateName,
    cron: s.cronExpression,
    tag: s.tag,
  }));
}

/**
 * Executa um slot manualmente (para teste).
 */
export async function fireSlotNow(slotIndex: number): Promise<string> {
  const schedule = DEFAULT_SCHEDULE;
  if (slotIndex < 0 || slotIndex >= schedule.length) {
    return `Índice inválido. Use 0-${schedule.length - 1}`;
  }
  const slot = schedule[slotIndex];
  await executeSlot(slot);
  return `Slot "${slot.description}" executado`;
}
