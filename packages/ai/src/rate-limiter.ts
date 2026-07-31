/**
 * Простой in-memory rate limiter для вызовов AI.
 * Roadmap 5.13: rate limiting вызовов AI.
 *
 * Реализован как token bucket: каждую секунду восстанавливается
 * фиксированное количество токенов. Если токенов нет — вызов ждёт.
 *
 * Для MVP локальной модели лимиты по умолчанию мягкие (30 запросов/мин),
 * переопределяются через AI_RATE_LIMIT_PER_MINUTE.
 */

export interface RateLimiterConfig {
  requestsPerMinute: number;
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRatePerMs: number;

  constructor(config: RateLimiterConfig) {
    this.capacity = Math.max(1, config.requestsPerMinute);
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
    this.refillRatePerMs = this.capacity / 60_000;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const waitMs = Math.ceil((1 - this.tokens) / this.refillRatePerMs);
    await sleep(waitMs);
    return this.acquire();
  }

  private refill(): void {
    const now = Date.now();
    const deltaMs = now - this.lastRefill;
    const tokensToAdd = deltaMs * this.refillRatePerMs;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
