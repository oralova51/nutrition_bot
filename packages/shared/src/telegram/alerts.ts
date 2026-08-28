// Сервис административных алертов в Telegram (roadmap 10.3, 10.8).
// Best-effort: если ADMIN_ALERT_TELEGRAM_ID не задан или отправка не удалась —
// ошибка только в лог, работа системы не прерывается.

import { createLogger } from '../logging/logger.js';
import { getBot } from './bot.js';

const logger = createLogger('telegram-alerts');

function resolveAdminTelegramId(): string | undefined {
  const raw = process.env.ADMIN_ALERT_TELEGRAM_ID;
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }
  return raw.trim();
}

/**
 * Отправляет личное сообщение администратору в Telegram.
 * Используется при критических ошибках доставки, массовых сбоях (nonFR §6)
 * и сводке администратору по завершении курса.
 */
export async function sendAdminAlert(text: string): Promise<void> {
  const adminId = resolveAdminTelegramId();
  if (!adminId) {
    logger.debug('ADMIN_ALERT_TELEGRAM_ID не задан, алерт администратору не отправлен');
    return;
  }

  try {
    await getBot().api.sendMessage(adminId, text, { parse_mode: 'HTML' });
    logger.info({ adminId }, 'Административный алерт отправлен');
  } catch (err) {
    logger.error({ adminId, err }, 'Не удалось отправить административный алерт');
    throw err;
  }
}
