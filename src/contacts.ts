import db from "./database";
import { logger } from "./logger";
import fs from "fs";
import path from "path";

/**
 * Validar formato de telefone brasileiro
 * Aceita: 5511999990001, +5511999990001, 11999990001, (11) 99999-0001, etc.
 * Retorna o número limpo (só dígitos, com DDI 55) ou null se inválido
 */
export function validateAndCleanPhone(phone: string): string | null {
  // Remover tudo que não é dígito
  const cleaned = phone.replace(/\D/g, "");

  // Número brasileiro com DDI: 55 + DDD (2) + número (8-9) = 12-13 dígitos
  // Sem DDI: DDD (2) + número (8-9) = 10-11 dígitos
  const brWithDDI = /^55([1-9]\d)(9?\d{8})$/;
  const brWithoutDDI = /^([1-9]\d)(9?\d{8})$/;

  if (brWithDDI.test(cleaned)) {
    return cleaned;
  }

  if (brWithoutDDI.test(cleaned)) {
    return `55${cleaned}`;
  }

  // Aceitar números internacionais (outros países): mínimo 10 dígitos
  if (cleaned.length >= 10 && cleaned.length <= 15) {
    return cleaned;
  }

  return null;
}

/**
 * Importar contatos de um arquivo CSV
 * Formato esperado: phone,name,tags
 */
export function importContactsFromCSV(filePath: string): { imported: number; skipped: number } {
  const content = fs.readFileSync(path.resolve(filePath), "utf-8");
  const lines = content.trim().split("\n");
  const results = { imported: 0, skipped: 0 };

  // Pular header
  const dataLines = lines[0]?.includes("phone") ? lines.slice(1) : lines;

  const stmt = db.prepare(
    `INSERT INTO contacts (phone, name, tags, opted_in, opted_in_at)
     VALUES (?, ?, ?, 1, datetime('now'))
     ON CONFLICT(phone) DO UPDATE SET name = COALESCE(?, name), tags = COALESCE(?, tags), updated_at = datetime('now')`
  );

  const insertMany = db.transaction((rows: string[][]) => {
    for (const row of rows) {
      const [rawPhone, name = "", tags = ""] = row;
      const phone = validateAndCleanPhone(rawPhone || "");
      if (!phone) {
        results.skipped++;
        continue;
      }
      try {
        stmt.run(phone, name.trim(), tags.trim(), name.trim(), tags.trim());
        results.imported++;
      } catch {
        results.skipped++;
      }
    }
  });

  const parsed = dataLines.map((line) => line.split(",").map((col) => col.trim()));
  insertMany(parsed);

  logger.info(`Importação concluída`, results);
  return results;
}

/**
 * Obter contatos por tag, excluindo opt-outs
 */
export function getContactsByTag(tag: string): Array<{ phone: string; name: string }> {
  return db
    .prepare(
      `SELECT phone, name FROM contacts
       WHERE tags LIKE ? AND opted_out = 0 AND opted_in = 1
       ORDER BY created_at DESC`
    )
    .all(`%${tag}%`) as Array<{ phone: string; name: string }>;
}

/**
 * Obter contatos inativos (não receberam mensagem nos últimos X dias)
 */
export function getInactiveContacts(days: number): Array<{ phone: string; name: string }> {
  return db
    .prepare(
      `SELECT c.phone, c.name FROM contacts c
       WHERE c.opted_out = 0
       AND c.opted_in = 1
       AND c.phone NOT IN (
         SELECT DISTINCT contact_phone FROM messages
         WHERE sent_at >= datetime('now', ? || ' days')
         AND status = 'sent'
       )
       ORDER BY c.created_at DESC`
    )
    .all(`-${days}`) as Array<{ phone: string; name: string }>;
}

/**
 * Relatório de performance das campanhas
 */
export function getCampaignStats(templateName?: string): {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  deliveryRate: string;
  readRate: string;
} {
  const whereClause = templateName
    ? "WHERE template_name = ?"
    : "";
  const params = templateName ? [templateName] : [];

  const stats = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status IN ('delivered','read') THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) as read_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM messages ${whereClause}`
    )
    .get(...params) as any;

  const total = stats.total || 0;
  const sent = stats.sent || 0;
  const delivered = stats.delivered || 0;
  const readCount = stats.read_count || 0;

  return {
    total,
    sent,
    delivered,
    read: readCount,
    failed: stats.failed || 0,
    deliveryRate: sent > 0 ? `${((delivered / sent) * 100).toFixed(1)}%` : "0%",
    readRate: delivered > 0 ? `${((readCount / delivered) * 100).toFixed(1)}%` : "0%",
  };
}

/**
 * Limpar contatos que deram opt-out há mais de X dias
 */
export function cleanOptedOutContacts(olderThanDays: number = 30): number {
  const result = db
    .prepare(
      `DELETE FROM contacts
       WHERE opted_out = 1
       AND opted_out_at <= datetime('now', ? || ' days')`
    )
    .run(`-${olderThanDays}`);
  logger.info(`${result.changes} contatos opt-out removidos`);
  return result.changes;
}
