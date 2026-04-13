import { validateAndCleanPhone } from "../src/contacts";

describe("validateAndCleanPhone", () => {
  // Números brasileiros válidos
  test("aceita número BR completo com DDI (13 dígitos - celular)", () => {
    expect(validateAndCleanPhone("5511999990001")).toBe("5511999990001");
  });

  test("aceita número BR completo com DDI (12 dígitos - fixo)", () => {
    expect(validateAndCleanPhone("551133334444")).toBe("551133334444");
  });

  test("adiciona DDI 55 se não presente (celular)", () => {
    expect(validateAndCleanPhone("11999990001")).toBe("5511999990001");
  });

  test("adiciona DDI 55 se não presente (fixo)", () => {
    expect(validateAndCleanPhone("1133334444")).toBe("551133334444");
  });

  test("limpa formatação com parênteses, hifens e espaços", () => {
    expect(validateAndCleanPhone("(11) 99999-0001")).toBe("5511999990001");
  });

  test("limpa número com + na frente", () => {
    expect(validateAndCleanPhone("+5511999990001")).toBe("5511999990001");
  });

  // Números inválidos
  test("rejeita número muito curto", () => {
    expect(validateAndCleanPhone("12345")).toBeNull();
  });

  test("rejeita string vazia", () => {
    expect(validateAndCleanPhone("")).toBeNull();
  });

  test("rejeita texto sem números", () => {
    expect(validateAndCleanPhone("abc")).toBeNull();
  });

  // Números internacionais
  test("aceita número internacional com 12+ dígitos", () => {
    expect(validateAndCleanPhone("14155551234")).not.toBeNull();
  });
});
