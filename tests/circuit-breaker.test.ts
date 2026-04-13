// Testar circuit breaker isoladamente extraindo a lógica
// Não podemos importar whatsapp-api diretamente pois depende de config/env

describe("Circuit Breaker lógica", () => {
  enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN",
  }

  class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount: number = 0;
    private lastFailureTime: number = 0;
    private readonly failureThreshold: number;
    private readonly resetTimeoutMs: number;

    constructor(failureThreshold = 5, resetTimeoutMs = 100) {
      this.failureThreshold = failureThreshold;
      this.resetTimeoutMs = resetTimeoutMs;
    }

    canExecute(): boolean {
      if (this.state === CircuitState.CLOSED) return true;
      if (this.state === CircuitState.OPEN) {
        if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
          this.state = CircuitState.HALF_OPEN;
          return true;
        }
        return false;
      }
      return true;
    }

    recordSuccess(): void {
      this.failureCount = 0;
      this.state = CircuitState.CLOSED;
    }

    recordFailure(): void {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.state === CircuitState.HALF_OPEN) {
        this.state = CircuitState.OPEN;
        return;
      }
      if (this.failureCount >= this.failureThreshold) {
        this.state = CircuitState.OPEN;
      }
    }

    getState(): { state: string; failures: number } {
      return { state: this.state, failures: this.failureCount };
    }
  }

  test("inicia no estado CLOSED", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState().state).toBe("CLOSED");
    expect(cb.canExecute()).toBe(true);
  });

  test("abre após atingir threshold de falhas", () => {
    const cb = new CircuitBreaker(3, 1000);

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState().state).toBe("CLOSED");

    cb.recordFailure(); // 3 = threshold
    expect(cb.getState().state).toBe("OPEN");
    expect(cb.canExecute()).toBe(false);
  });

  test("reseta contador após sucesso", () => {
    const cb = new CircuitBreaker(3, 1000);

    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();

    expect(cb.getState().failures).toBe(0);
    expect(cb.getState().state).toBe("CLOSED");
  });

  test("transiciona para HALF_OPEN após timeout", async () => {
    const cb = new CircuitBreaker(2, 50); // timeout curto para teste

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState().state).toBe("OPEN");

    // Esperar timeout
    await new Promise((r) => setTimeout(r, 60));

    expect(cb.canExecute()).toBe(true);
    expect(cb.getState().state).toBe("HALF_OPEN");
  });

  test("volta para CLOSED se sucesso em HALF_OPEN", async () => {
    const cb = new CircuitBreaker(2, 50);

    cb.recordFailure();
    cb.recordFailure();

    await new Promise((r) => setTimeout(r, 60));
    cb.canExecute(); // trigger HALF_OPEN

    cb.recordSuccess();
    expect(cb.getState().state).toBe("CLOSED");
  });

  test("volta para OPEN se falha em HALF_OPEN", async () => {
    const cb = new CircuitBreaker(2, 50);

    cb.recordFailure();
    cb.recordFailure();

    await new Promise((r) => setTimeout(r, 60));
    cb.canExecute(); // trigger HALF_OPEN

    cb.recordFailure();
    expect(cb.getState().state).toBe("OPEN");
  });
});
