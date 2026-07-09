// Конфигурация API-сервиса (порт, версия для health-check, admin-auth, deep link).

export const API_VERSION = '0.1.0';

const DEFAULT_PORT = 3000;

export function resolvePort(): number {
  const raw = process.env.PORT;
  if (!raw) {
    return DEFAULT_PORT;
  }

  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT должен быть целым числом 1–65535, получено: "${raw}"`);
  }

  return port;
}

/** adminAPI.md §1: статический Bearer-токен для admin API (MVP). */
export function resolveAdminApiToken(): string {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    throw new Error('ADMIN_API_TOKEN не задан. Укажите переменную окружения (см. .env.example).');
  }
  return token;
}

/** Username бота (без @) для построения deep link — adminAPI.md §2. */
export function resolveBotUsername(): string {
  const username = process.env.BOT_USERNAME;
  if (!username) {
    throw new Error('BOT_USERNAME не задан. Укажите переменную окружения (см. .env.example).');
  }
  return username;
}
