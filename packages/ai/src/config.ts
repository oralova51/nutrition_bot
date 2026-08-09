/**
 * Конфигурация AI Engine.
 * Переменные окружения читаются из process.env.
 */

export type AIProvider = 'mock' | 'openai-compatible';

export interface AIConfig {
  provider: AIProvider;
  /** API ключ для реального провайдера. */
  apiKey: string;
  /** Базовый URL для OpenAI-compatible API (Ollama, vLLM и т.д.). */
  baseURL: string;
  /** Название модели для chat completions. */
  model: string;
  /** Максимальное число токенов в ответе. */
  maxTokens: number;
  /**
   * Лимит токенов именно для вечерней сводки.
   * У reasoning-моделей (DeepSeek и др.) thinking тоже входит в max_tokens,
   * поэтому для JSON-сводки нужен отдельный более высокий бюджет.
   */
  eveningSummaryMaxTokens: number;
  /** Температура генерации. */
  temperature: number;
  /** Таймаут запроса в миллисекундах. */
  requestTimeoutMs: number;
  /** Лимит запросов к AI в минуту. */
  rateLimitPerMinute: number;
}

function resolveProvider(): AIProvider {
  const value = process.env.AI_PROVIDER;
  if (value === 'openai-compatible') return 'openai-compatible';
  return 'mock';
}

export function resolveAIConfig(): AIConfig {
  return {
    provider: resolveProvider(),
    apiKey: process.env.AI_API_KEY ?? '',
    baseURL: process.env.AI_BASE_URL ?? 'http://localhost:11434/v1',
    model: process.env.AI_MODEL ?? 'llama3.1',
    maxTokens: Number.parseInt(process.env.AI_MAX_TOKENS ?? '512', 10),
    eveningSummaryMaxTokens: Number.parseInt(
      process.env.AI_EVENING_SUMMARY_MAX_TOKENS ?? '4096',
      10,
    ),
    temperature: Number.parseFloat(process.env.AI_TEMPERATURE ?? '0.7'),
    requestTimeoutMs: Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS ?? '30000', 10),
    rateLimitPerMinute: Number.parseInt(process.env.AI_RATE_LIMIT_PER_MINUTE ?? '30', 10),
  };
}
