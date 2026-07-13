// Точка входа планировщика: cron/BullMQ, выборка клиентов по слотам.
// Выбор движка и job-ы добавляются на шагах 4.1 и далее.

import { Bot } from 'grammy';
import { schedule } from 'node-cron';
import {
  closeDatabaseConnection,
  createLogger,
  ensureModelsInitialized,
  LOG_EVENTS,
} from '@nutrition-bot/shared';
import { resolveBotToken } from './config.js';
import { runDailyReminderJob } from './jobs/daily-reminder.js';
import { runQuestionnaireReminderJob } from './jobs/questionnaire-reminder.js';

export const SERVICE_NAME = 'scheduler';
export const logger = createLogger(SERVICE_NAME);

async function main(): Promise<void> {
  ensureModelsInitialized();

  const token = resolveBotToken();
  const bot = new Bot(token);
  const me = await bot.api.getMe();
  logger.info({ botUsername: me.username }, 'Токен Telegram проверен (getMe)');

  // Ежедневное напоминание о дневнике (roadmap 4.2–4.7).
  // TIME_SLOTS в настройках с шагом 30 минут, поэтому job запускается каждые 30 минут.
  schedule('*/30 * * * *', () => {
    void runDailyReminderJob(logger).catch((err: unknown) => {
      logger.error({ err }, 'Ежедневное напоминание: необработанная ошибка job');
    });
  });

  // Напоминание о брошенной анкете (roadmap 3.14), N = 2 минуты для теста.
  schedule('*/2 * * * *', () => {
    void runQuestionnaireReminderJob(logger).catch((err: unknown) => {
      logger.error({ err }, 'Напоминание об анкете: необработанная ошибка job');
    });
  });

  logger.info(
    { event: LOG_EVENTS.SERVICE_STARTED },
    `${SERVICE_NAME} service started with scheduled jobs`,
  );
}

void main().catch((err: unknown) => {
  logger.fatal({ err }, `${SERVICE_NAME} service failed to start`);
  process.exit(1);
});

function shutdown(signal: string): void {
  logger.info({ signal }, `Shutting down ${SERVICE_NAME} service`);

  void closeDatabaseConnection()
    .then(() => {
      logger.info(`${SERVICE_NAME} service stopped`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      logger.error({ err }, `Error while shutting down ${SERVICE_NAME} service`);
      process.exit(1);
    });
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
