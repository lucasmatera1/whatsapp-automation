import winston from "winston";
import Transport from "winston-transport";
import fs from "fs";
import path from "path";

// Garantir que o diretório de logs existe
const logsDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// ========================
// Ring-buffer transport — mantém últimas N entradas em memória
// ========================
interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  [key: string]: unknown;
}

const MAX_MEMORY_LOGS = 2000;
const memoryLogs: LogEntry[] = [];
const logListeners: Array<(entry: LogEntry) => void> = [];

class MemoryTransport extends Transport {
  log(info: any, callback: () => void): void {
    setImmediate(() => this.emit("logged", info));
    const entry: LogEntry = {
      timestamp: info.timestamp ?? new Date().toISOString(),
      level: info.level,
      message: info.message,
      ...(info.service ? { service: info.service } : {}),
    };
    // Copiar campos extras (ip, code, etc)
    for (const k of Object.keys(info)) {
      if (!["timestamp", "level", "message", "service", "Symbol(level)", "Symbol(splat)"].includes(k) && !k.startsWith("Symbol")) {
        entry[k] = info[k];
      }
    }
    memoryLogs.push(entry);
    if (memoryLogs.length > MAX_MEMORY_LOGS) memoryLogs.shift();
    for (const fn of logListeners) { try { fn(entry); } catch { /* */ } }
    callback();
  }
}

/** Retorna as últimas `count` entradas (mais recentes primeiro) */
export function getRecentLogs(count = 100, filter?: { level?: string; search?: string }): LogEntry[] {
  let logs = memoryLogs;
  if (filter?.level) {
    logs = logs.filter(l => l.level === filter.level);
  }
  if (filter?.search) {
    const q = filter.search.toLowerCase();
    logs = logs.filter(l => l.message.toLowerCase().includes(q) || JSON.stringify(l).toLowerCase().includes(q));
  }
  return logs.slice(-count).reverse();
}

/** SSE: subscribe para novos logs em tempo real */
export function onLogEntry(fn: (entry: LogEntry) => void): () => void {
  logListeners.push(fn);
  return () => { const i = logListeners.indexOf(fn); if (i >= 0) logListeners.splice(i, 1); };
}

/** Lê arquivo de log com paginação (tail) */
export function readLogFile(filename: "combined" | "error", lines = 200, offset = 0): { lines: string[]; total: number } {
  const filePath = path.join(logsDir, `${filename}.log`);
  if (!fs.existsSync(filePath)) return { lines: [], total: 0 };
  const content = fs.readFileSync(filePath, "utf-8");
  const allLines = content.split("\n").filter(l => l.trim());
  const total = allLines.length;
  const start = Math.max(0, total - lines - offset);
  const end = Math.max(0, total - offset);
  return { lines: allLines.slice(start, end).reverse(), total };
}

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "whatsapp-automation" },
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
    new MemoryTransport(),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...rest }) => {
          const extra = Object.keys(rest).length > 1 ? ` ${JSON.stringify(rest)}` : "";
          return `${timestamp} [${level}]: ${message}${extra}`;
        })
      ),
    }),
  ],
});
