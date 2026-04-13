import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  WHATSAPP_TOKEN: z.string().min(1),
  PHONE_NUMBER_ID: z.string().min(1),
  WABA_ID: z.string().min(1),
  VERIFY_TOKEN: z.string().min(1),
  APP_SECRET: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().default(6379),
  WARMUP_PHASE: z.coerce.number().min(1).max(4).default(1),
  WARMUP_DAILY_LIMIT: z.coerce.number().default(50),
  WARMUP_MIN_INTERVAL: z.coerce.number().default(8000),
  WARMUP_MAX_INTERVAL: z.coerce.number().default(25000),
  WARMUP_LONG_PAUSE_CHANCE: z.coerce.number().default(0.12),
  WARMUP_LONG_PAUSE_MAX: z.coerce.number().default(60000),
  ADMIN_USER: z.string().default("admin"),
  ADMIN_PASS: z.string().default("reino2026"),
  JWT_SECRET: z.string().default("wa-auto-jwt-secret-change-me"),
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
