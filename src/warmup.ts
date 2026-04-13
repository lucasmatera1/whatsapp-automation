import { config } from "./config";
import { whatsappApi } from "./whatsapp-api";
import { logger } from "./logger";
import db from "./database";
import cron from "node-cron";

interface WarmupPhase {
  phase: number;
  dailyLimit: number;
  intervalMs: number;
  description: string;
}

const WARMUP_PHASES: WarmupPhase[] = [
  { phase: 1, dailyLimit: 50, intervalMs: 15000, description: "Fase Inicial - máx 50/dia, intervalo ~15s" },
  { phase: 2, dailyLimit: 200, intervalMs: 10000, description: "Expansão Leve - máx 200/dia, intervalo ~10s" },
  { phase: 3, dailyLimit: 1000, intervalMs: 7000, description: "Expansão Moderada - máx 1000/dia, intervalo ~7s" },
  { phase: 4, dailyLimit: 10000, intervalMs: 4000, description: "Escala - máx 10000/dia, intervalo ~4s" },
];

export class WarmupManager {
  private currentPhase: WarmupPhase;
  private sentToday: number = 0;

  constructor() {
    const phaseNum = config.WARMUP_PHASE;
    this.currentPhase = WARMUP_PHASES[phaseNum - 1] || WARMUP_PHASES[0];
    this.sentToday = this.getTodaySentCount();
    logger.info(`WarmupManager inicializado`, {
      phase: this.currentPhase.phase,
      description: this.currentPhase.description,
      sentToday: this.sentToday,
    });
  }

  /**
   * Obter contagem de mensagens enviadas hoje
   */
  private getTodaySentCount(): number {
    const today = new Date().toLocaleDateString('en-CA');
    const row = db
      .prepare("SELECT messages_sent FROM warmup_log WHERE date = ?")
      .get(today) as { messages_sent: number } | undefined;
    return row?.messages_sent || 0;
  }

  /**
   * Atualizar log de aquecimento do dia
   */
  private updateDailyLog(): void {
    const today = new Date().toLocaleDateString('en-CA');
    const existing = db
      .prepare("SELECT id FROM warmup_log WHERE date = ?")
      .get(today) as { id: number } | undefined;

    if (existing) {
      db.prepare("UPDATE warmup_log SET messages_sent = ? WHERE id = ?").run(
        this.sentToday,
        existing.id
      );
    } else {
      db.prepare(
        "INSERT INTO warmup_log (date, messages_sent, phase) VALUES (?, ?, ?)"
      ).run(today, this.sentToday, this.currentPhase.phase);
    }
  }

  /**
   * Verificar se pode enviar mais mensagens hoje
   */
  canSendMore(): boolean {
    return this.sentToday < this.currentPhase.dailyLimit;
  }

  /**
   * Retorna quantas mensagens ainda podem ser enviadas hoje
   */
  remainingToday(): number {
    return Math.max(0, this.currentPhase.dailyLimit - this.sentToday);
  }

  /**
   * Registrar envio (chamado pelo worker da queue)
   */
  recordSent(): void {
    this.sentToday++;
    this.updateDailyLog();
  }

  /**
   * Verificar qualidade do número antes do envio em batch
   * Retorna true se pode enviar, false se deve bloquear
   */
  async checkQualityForSending(): Promise<{ canSend: boolean; reason?: string }> {
    try {
      const quality = await whatsappApi.getPhoneQuality();
      logger.info(`Quality Rating: ${quality.quality_rating}`);

      if (quality.quality_rating === "RED") {
        return { canSend: false, reason: "Quality Rating VERMELHO! Envio bloqueado por segurança." };
      }

      if (quality.quality_rating === "YELLOW") {
        const reducedLimit = Math.floor(this.currentPhase.dailyLimit * 0.5);
        if (this.sentToday >= reducedLimit) {
          return { canSend: false, reason: "Quality Rating AMARELO e limite reduzido atingido." };
        }
        logger.warn("Quality Rating AMARELO! Volume reduzido em 50%.");
      }

      return { canSend: true };
    } catch {
      logger.warn("Não foi possível verificar Quality Rating, prosseguindo com cautela");
      return { canSend: true };
    }
  }

  /**
   * Verificar e sugerir promoção de fase
   */
  async checkPhasePromotion(): Promise<string> {
    try {
      const quality = await whatsappApi.getPhoneQuality();

      if (quality.quality_rating !== "GREEN") {
        return `Quality Rating: ${quality.quality_rating}. Mantenha-se na fase ${this.currentPhase.phase} até melhorar.`;
      }

      // Verificar histórico dos últimos 7 dias
      const rows = db
        .prepare(
          `SELECT AVG(messages_sent) as avg_sent FROM warmup_log
           WHERE date >= date('now', '-7 days')`
        )
        .get() as { avg_sent: number } | undefined;

      const avgSent = rows?.avg_sent || 0;
      const threshold = this.currentPhase.dailyLimit * 0.7;

      if (avgSent >= threshold && this.currentPhase.phase < 4) {
        const nextPhase = WARMUP_PHASES[this.currentPhase.phase];
        return `✅ Pronto para avançar! Média: ${Math.round(avgSent)}/dia. Atualize WARMUP_PHASE para ${nextPhase.phase} no .env`;
      }

      return `Fase ${this.currentPhase.phase}: Média ${Math.round(avgSent)}/dia (precisa de ${Math.round(threshold)} para avançar). Quality: ${quality.quality_rating}`;
    } catch (error: any) {
      return `Erro ao verificar: ${error.message}`;
    }
  }

  /**
   * Obter relatório do dia
   */
  getDailyReport(): {
    phase: number;
    sentToday: number;
    dailyLimit: number;
    remaining: number;
    percentage: string;
  } {
    return {
      phase: this.currentPhase.phase,
      sentToday: this.sentToday,
      dailyLimit: this.currentPhase.dailyLimit,
      remaining: this.remainingToday(),
      percentage: `${((this.sentToday / this.currentPhase.dailyLimit) * 100).toFixed(1)}%`,
    };
  }

  /**
   * Agendar reset diário do contador (meia-noite)
   */
  scheduleDailyReset(): void {
    cron.schedule("0 0 * * *", () => {
      logger.info(`Reset diário do aquecimento. Enviados ontem: ${this.sentToday}`);
      this.sentToday = 0;
      this.updateDailyLog();
    });
    logger.info("Reset diário agendado para 00:00");
  }
}

export const warmupManager = new WarmupManager();
