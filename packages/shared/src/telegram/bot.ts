// Единый экземпляр grammY-бота для отправки сообщений из разных сервисов.
// Используется sender.ts и alerts.ts, чтобы избежать дублирования и циклических зависимостей.

import { Bot } from 'grammy';

let botInstance: Bot | undefined;

export function getBot(): Bot {
  if (!botInstance) {
    const token = process.env.TELEGRAM_API;
    if (!token) {
      throw new Error('TELEGRAM_API не задан. Укажите переменную окружения (см. .env.example).');
    }
    botInstance = new Bot(token);
  }
  return botInstance;
}
