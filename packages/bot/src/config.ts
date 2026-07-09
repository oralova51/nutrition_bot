// Конфигурация Telegram-бота: токен, режим запуска, параметры webhook.
// adminAPI.md §6.1, §9 (п.3): dev — long polling, prod — webhook + secret_token.

export type BotMode = 'polling' | 'webhook';

const DEFAULT_BOT_MODE: BotMode = 'polling';
const DEFAULT_BOT_PORT = 3001;

/** adminAPI.md §6.2: рекомендуемые allowed_updates для MVP. */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'] as const;

export function resolveBotToken(): string {
  const token = process.env.TELEGRAM_API;
  if (!token) {
    throw new Error('TELEGRAM_API не задан. Укажите переменную окружения (см. .env.example).');
  }
  return token;
}

export function resolveBotMode(): BotMode {
  const raw = process.env.BOT_MODE?.toLowerCase();
  if (!raw) {
    return DEFAULT_BOT_MODE;
  }
  if (raw === 'polling' || raw === 'webhook') {
    return raw;
  }
  throw new Error(`BOT_MODE должен быть "polling" или "webhook", получено: "${raw}"`);
}

export function resolveBotPort(): number {
  const raw = process.env.BOT_PORT;
  if (!raw) {
    return DEFAULT_BOT_PORT;
  }

  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`BOT_PORT должен быть целым числом 1–65535, получено: "${raw}"`);
  }

  return port;
}

export interface WebhookConfig {
  /** Публичный HTTPS-адрес, который передаётся в Telegram setWebhook. */
  url: string;
  /** Значение X-Telegram-Bot-Api-Secret-Token для проверки входящих запросов. */
  secretToken: string;
}

export function resolveWebhookConfig(): WebhookConfig {
  const url = process.env.WEBHOOK_URL;
  const secretToken = process.env.WEBHOOK_SECRET_TOKEN;

  if (!url) {
    throw new Error('WEBHOOK_URL не задан — обязателен при BOT_MODE=webhook (см. .env.example).');
  }
  if (!secretToken) {
    throw new Error(
      'WEBHOOK_SECRET_TOKEN не задан — обязателен при BOT_MODE=webhook (см. .env.example).',
    );
  }

  return { url, secretToken };
}
