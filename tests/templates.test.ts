// Mock das dependências antes de importar
jest.mock("../src/whatsapp-api", () => ({
  whatsappApi: {
    createTemplate: jest.fn().mockResolvedValue({ id: "mock-id" }),
    listTemplates: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock("../src/config", () => ({
  config: {
    WHATSAPP_TOKEN: "test-token",
    PHONE_NUMBER_ID: "test-phone-id",
    WABA_ID: "test-waba-id",
    VERIFY_TOKEN: "test-verify",
    APP_SECRET: "test-secret",
    PORT: 3000,
    NODE_ENV: "development",
    REDIS_HOST: "127.0.0.1",
    REDIS_PORT: 6379,
    WARMUP_PHASE: 1,
    WARMUP_DAILY_LIMIT: 50,
    WARMUP_MIN_INTERVAL: 5000,
  },
}));

jest.mock("../src/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { TEMPLATE_LIBRARY, listLocalTemplates, buildBodyParams } from "../src/templates";

describe("Templates", () => {
  test("biblioteca tem templates de todas as categorias", () => {
    const templates = Object.values(TEMPLATE_LIBRARY);

    const categories = [...new Set(templates.map((t) => t.category))];
    expect(categories).toContain("MARKETING");
    expect(categories).toContain("UTILITY");
    expect(categories).toContain("AUTHENTICATION");
  });

  test("todos os templates têm campos obrigatórios", () => {
    for (const [, t] of Object.entries(TEMPLATE_LIBRARY)) {
      expect(t.name).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.language).toBe("pt_BR");
      expect(t.components).toBeInstanceOf(Array);
      expect(t.components.length).toBeGreaterThan(0);
      expect(t.description).toBeTruthy();
    }
  });

  test("templates de marketing têm footer com opt-out", () => {
    const marketing = Object.values(TEMPLATE_LIBRARY).filter(
      (t) => t.category === "MARKETING"
    );

    for (const t of marketing) {
      const footer = t.components.find((c: any) => c.type === "FOOTER");
      expect(footer).toBeDefined();
      expect(footer?.text?.toLowerCase()).toContain("parar");
    }
  });

  test("listLocalTemplates retorna todos os templates", () => {
    const list = listLocalTemplates();
    expect(list.length).toBe(Object.keys(TEMPLATE_LIBRARY).length);

    for (const item of list) {
      expect(item.key).toBeTruthy();
      expect(item.name).toBeTruthy();
      expect(item.category).toBeTruthy();
      expect(item.description).toBeTruthy();
    }
  });

  test("buildBodyParams constrói componentes corretos", () => {
    const result = buildBodyParams("João", "20% off");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("body");
    expect(result[0].parameters).toHaveLength(2);
    expect(result[0].parameters[0]).toEqual({ type: "text", text: "João" });
    expect(result[0].parameters[1]).toEqual({ type: "text", text: "20% off" });
  });
});
