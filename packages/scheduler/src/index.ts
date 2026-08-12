// Точка входа планировщика: cron + HTTP API для ручного запуска job'ов.
// Выбор движка и job-ы добавляются на шагах 4.1 и далее.

import { Bot } from 'grammy';
import { schedule } from 'node-cron';
import {
  closeDatabaseConnection,
  createLogger,
  ensureModelsInitialized,
  LOG_EVENTS,
} from '@nutrition-bot/shared';
import type { Server } from 'node:http';
import { resolveAdminApiToken, resolveBotToken, resolveSchedulerPort } from './config.js';
import { createSchedulerHttpServer } from './http-server.js';
import { runDailyReminderJob } from './jobs/daily-reminder.js';
import { runEveningReminderJob } from './jobs/evening-reminder-job.js';
import { runEveningSummaryJob } from './jobs/evening-summary-job.js';
import { runCourseCompletionJob } from './jobs/course-completion-job.js';
import { runDataRetentionJob } from './jobs/data-retention-job.js';
import { runDeliveryFailureAlertJob } from './jobs/delivery-failure-alert-job.js';
import { runInactivityDeactivationJob } from './jobs/inactivity-deactivation-job.js';
import { runInactivityWarningJob } from './jobs/inactivity-warning-job.js';
import { runPendingDiaryJob } from './jobs/pending-diary-job.js';
import { runRecommendationDeliveryJob } from './jobs/recommendation-delivery-job.js';
import { runQuestionnaireReminderJob } from './jobs/questionnaire-reminder.js';
import { runUptimeMonitorJob } from './jobs/uptime-monitor-job.js';

export const SERVICE_NAME = 'scheduler';
export const logger = createLogger(SERVICE_NAME);

let httpServer: Server | undefined;

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

  // Создание pending-записей дневника за день без данных (roadmap 4.14).
  // 00:30 UTC = после полуночи для всех российских часовых поясов.
  schedule('30 0 * * *', () => {
    void runPendingDiaryJob(logger).catch((err: unknown) => {
      logger.error({ err }, 'Pending-записи дневника: необработанная ошибка job');
    });
  });

  // Вечернее напоминание о незаполненном дневнике (roadmap 4.16–4.19).
  // Проверяем каждые 30 минут, чтобы попасть в 20:00 для каждого часового пояса.
  schedule('*/30 * * * *', () => {
    void runEveningReminderJob(logger).catch((err: unknown) => {
      logger.error({ err }, 'Вечернее напоминание: необработанная ошибка job');
    });
  });

  // Ежедневная вечерняя сводка питания (roadmap 4.20–4.24, ФТ-24).
  // 21:00 — после evening reminder, чтобы клиент успел дописать ужин.
  schedule('*/30 * * * *', () => {
    void runEveningSummaryJob(logger).catch((err: unknown) => {
      logger.error({ err }, 'Вечерняя сводка: необработанная ошибка job');
    });
  });

  // Отложенная отправка рекомендаций medium/low (roadmap 5.8).
  // Проверяем каждые 30 минут, чтобы попасть в 20:00 для каждого часового пояса.
  schedule('*/30 * * * *', () => {
    void runRecommendationDeliveryJob(logger).catch((err: unknown) => {
      logger.error({ err }, 'Отложенная отправка рекомендаций: необработанная ошибка job');
    });
  });

  // Предупреждение о неактивности (roadmap 6.3, ФТ-9): 48 ч молчания → 10:00 по часовому поясу клиента.
  // Проверяем каждые 30 минут, чтобы попасть в 10:00 для каждого часового пояса.
  schedule('*/30 * * * *', () => {
    void runInactivityWarningJob(logger).catch((err: unknown) => {
      logger.error({ err }, 'Предупреждение о неактивности: необработанная ошибка job');
    });
  });

  // Автоотключение уведомлений по неактивности (roadmap 6.4–6.5, ФТ-10): 72+ ч молчания → off + лог.
  schedule('*/30 * * * *', () => {
    void runInactivityDeactivationJob(logger).catch((err: unknown) => {
      logger.error({ err }, 'Автоотключение уведомлений: необработанная ошибка job');
    });
  });

  // Завершение курса (roadmap 7.1–7.2, ФТ-13): перевод в completed и остановка регулярных напоминаний.
  // 00:01 UTC — после полуночи для российских часовых поясов, до утреннего напоминания.
  // Ручной тест: POST /internal/jobs/course-completion { force: true, clientId }.
  schedule('1 0 * * *', () => {
    void runCourseCompletionJob(logger).catch((err: unknown) => {
      logger.error({ err }, 'Завершение курса: необработанная ошибка job');
    });
  });

  // Массовые сбои доставки (roadmap 10.8, nonFR §6): алерт администратору при превышении порога.
  schedule('*/10 * * * *', () => {
    void runDeliveryFailureAlertJob(logger).catch((err: unknown) => {
      logger.error({ err }, 'Алерт массовых сбоев: необработанная ошибка job');
    });
  });

  // Политика хранения данных (roadmap 11.2): ежедневная очистка по сроку enrollment + 12 мес.
  schedule('0 2 * * *', () => {
    void runDataRetentionJob(logger).catch((err: unknown) => {
      logger.error({ err }, 'Политика хранения: необработанная ошибка job');
    });
  });

  // Мониторинг uptime API (roadmap 11.4): каждые 5 минут проверяем health endpoint.
  schedule('*/5 * * * *', () => {
    void runUptimeMonitorJob(logger).catch((err: unknown) => {
      logger.error({ err }, 'Мониторинг uptime: необработанная ошибка job');
    });
  });

  const port = resolveSchedulerPort();
  const adminApiToken = resolveAdminApiToken();
  httpServer = createSchedulerHttpServer(logger, adminApiToken);
  await new Promise<void>((resolve) => {
    httpServer?.listen(port, resolve);
  });

  logger.info(
    { event: LOG_EVENTS.SERVICE_STARTED, port },
    `${SERVICE_NAME} service started with scheduled jobs and HTTP API`,
  );
}

void main().catch((err: unknown) => {
  logger.fatal({ err }, `${SERVICE_NAME} service failed to start`);
  process.exit(1);
});

function shutdown(signal: string): void {
  logger.info({ signal }, `Shutting down ${SERVICE_NAME} service`);

  const stopHttp = new Promise<void>((resolve, reject) => {
    if (!httpServer) {
      resolve();
      return;
    }
    httpServer.close((err) => (err ? reject(err) : resolve()));
  });

  void stopHttp
    .then(() => closeDatabaseConnection())
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
