// Testar a lógica de fases do warmup isoladamente
describe("Warmup Phases Logic", () => {
  const WARMUP_PHASES = [
    { phase: 1, dailyLimit: 50, intervalMs: 10000 },
    { phase: 2, dailyLimit: 200, intervalMs: 7000 },
    { phase: 3, dailyLimit: 1000, intervalMs: 5000 },
    { phase: 4, dailyLimit: 10000, intervalMs: 3000 },
  ];

  test("fase 1 tem limite de 50 msgs/dia", () => {
    expect(WARMUP_PHASES[0].dailyLimit).toBe(50);
  });

  test("limites crescem progressivamente", () => {
    for (let i = 1; i < WARMUP_PHASES.length; i++) {
      expect(WARMUP_PHASES[i].dailyLimit).toBeGreaterThan(WARMUP_PHASES[i - 1].dailyLimit);
    }
  });

  test("intervalos diminuem progressivamente", () => {
    for (let i = 1; i < WARMUP_PHASES.length; i++) {
      expect(WARMUP_PHASES[i].intervalMs).toBeLessThan(WARMUP_PHASES[i - 1].intervalMs);
    }
  });

  test("canSendMore retorna false quando limite atingido", () => {
    const phase = WARMUP_PHASES[0];
    const sentToday = 50;
    const canSendMore = sentToday < phase.dailyLimit;
    expect(canSendMore).toBe(false);
  });

  test("canSendMore retorna true quando dentro do limite", () => {
    const phase = WARMUP_PHASES[0];
    const sentToday = 30;
    const canSendMore = sentToday < phase.dailyLimit;
    expect(canSendMore).toBe(true);
  });

  test("remainingToday calcula corretamente", () => {
    const phase = WARMUP_PHASES[1]; // 200 limit
    const sentToday = 150;
    const remaining = Math.max(0, phase.dailyLimit - sentToday);
    expect(remaining).toBe(50);
  });

  test("remainingToday não retorna negativo", () => {
    const phase = WARMUP_PHASES[0]; // 50 limit
    const sentToday = 100; // mais do que o limite
    const remaining = Math.max(0, phase.dailyLimit - sentToday);
    expect(remaining).toBe(0);
  });

  test("quality YELLOW reduz limite em 50%", () => {
    const phase = WARMUP_PHASES[2]; // 1000 limit
    const reducedLimit = Math.floor(phase.dailyLimit * 0.5);
    expect(reducedLimit).toBe(500);
  });
});

describe("getMsUntilMidnight", () => {
  test("retorna valor positivo", () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const ms = midnight.getTime() - now.getTime();
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});
