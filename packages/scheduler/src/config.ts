// Конфигурация scheduler: Telegram-токен, HTTP-порт для ручного запуска job'ов.

const DEFAULT_SCHEDULER_PORT = 3002;

export function resolveBotToken(): string {
  const token = process.env.TELEGRAM_API;
  if (!token) {
    throw new Error('TELEGRAM_API не задан. Укажите переменную окружения (см. .env.example).');
  }
  return token;
}

/** Порт HTTP API планировщика (ручной запуск job'ов через Postman). */
export function resolveSchedulerPort(): number {
  const raw = process.env.SCHEDULER_PORT;
  if (!raw) {
    return DEFAULT_SCHEDULER_PORT;
  }

  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`SCHEDULER_PORT должен быть целым числом 1–65535, получено: "${raw}"`);
  }

  return port;
}

/** Тот же admin-токен, что и у API — для локального теста через Postman. */
export function resolveAdminApiToken(): string {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    throw new Error('ADMIN_API_TOKEN не задан. Укажите переменную окружения (см. .env.example).');
  }
  return token;
}
