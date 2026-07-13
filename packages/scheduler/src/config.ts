// Конфигурация scheduler: проверка Telegram-токена, который используется sender.

export function resolveBotToken(): string {
  const token = process.env.TELEGRAM_API;
  if (!token) {
    throw new Error('TELEGRAM_API не задан. Укажите переменную окружения (см. .env.example).');
  }
  return token;
}
