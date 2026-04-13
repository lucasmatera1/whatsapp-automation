import crypto from "crypto";

// Testar a lógica de verificação de assinatura do webhook isoladamente
describe("Webhook Signature Verification", () => {
  const APP_SECRET = "test_app_secret_123";

  function verifySignature(body: any, signature: string | undefined, secret: string): boolean {
    if (!signature) return false;

    const rawBody = typeof body === "string" ? body : JSON.stringify(body);
    const expectedSignature =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false;
    }
  }

  test("aceita assinatura válida", () => {
    const body = { object: "whatsapp_business_account", entry: [] };
    const rawBody = JSON.stringify(body);
    const signature =
      "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");

    expect(verifySignature(body, signature, APP_SECRET)).toBe(true);
  });

  test("rejeita assinatura inválida", () => {
    const body = { object: "whatsapp_business_account" };
    expect(verifySignature(body, "sha256=invalid_hash", APP_SECRET)).toBe(false);
  });

  test("rejeita quando não há assinatura", () => {
    const body = { object: "whatsapp_business_account" };
    expect(verifySignature(body, undefined, APP_SECRET)).toBe(false);
  });

  test("rejeita assinatura com tamanho diferente", () => {
    const body = { object: "whatsapp_business_account" };
    expect(verifySignature(body, "sha256=abc", APP_SECRET)).toBe(false);
  });
});
