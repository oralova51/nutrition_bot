// Алерт администратору при массовых сбоях доставки Telegram (roadmap 10.8, nonFR §6).
// Считает сообщения со статусом delivery_failed за окно; если превышен порог —
// отправляет один алерт, но не чаще заданного интервала.

import { Op } from 'sequelize';
import { Message, sendAdminAlert } from '@nutrition-bot/shared';
import type { Logger } from 'pino';

interface AlertConfig {
  windowMinutes: number;
  threshold: number;
  minIntervalMinutes: number;
}

let lastAlertSentAt: Date | null = null;

function resolveConfig(): AlertConfig {
  const windowMinutes = parseIntPositive(process.env.MASS_FAILURE_WINDOW_MINUTES, 30);
  const threshold = parseIntPositive(process.env.MASS_FAILURE_THRESHOLD, 5);
  const minIntervalMinutes = parseIntPositive(process.env.MASS_FAILURE_ALERT_INTERVAL_MINUTES, 60);
  return { windowMinutes, threshold, minIntervalMinutes };
}

function parseIntPositive(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

export async function runDeliveryFailureAlertJob(logger: Logger): Promise<void> {
  const config = resolveConfig();
  const windowStart = new Date(Date.now() - config.windowMinutes * 60 * 1000);

  const failedCount = await Message.count({
    where: {
      deliveryStatus: 'delivery_failed',
      createdAt: { [Op.gte]: windowStart },
    },
  });

  logger.info(
    { failedCount, windowMinutes: config.windowMinutes, threshold: config.threshold },
    'Проверка массовых сбоев доставки',
  );

  if (failedCount < config.threshold) {
    return;
  }

  const minIntervalMs = config.minIntervalMinutes * 60 * 1000;
  if (lastAlertSentAt && Date.now() - lastAlertSentAt.getTime() < minIntervalMs) {
    logger.info(
      { lastAlertSentAt, minIntervalMinutes: config.minIntervalMinutes },
      'Алерт о массовом сбое уже отправлен недавно, пропускаем',
    );
    return;
  }

  const message =
    `🚨 Массовый сбой доставки Telegram\n\n` +
    `За последние ${config.windowMinutes} минут сообщений со статусом ` +
    `<code>delivery_failed</code>: <b>${failedCount}</b> (порог: ${config.threshold}).\n\n` +
    `Проверьте статус бота и логи.`;

  try {
    await sendAdminAlert(message);
    lastAlertSentAt = new Date();
    logger.warn(
      { failedCount, windowMinutes: config.windowMinutes },
      'Администратору отправлен алерт о массовом сбое доставки',
    );
  } catch (err) {
    logger.error({ err, failedCount }, 'Не удалось отправить алерт о массовом сбое доставки');
  }
}
