// Точка входа Telegram-бота: регистрация (проверка токена), инициализация моделей БД
// и запуск в режиме long polling (dev) или webhook (prod) — roadmap 2.1–2.2,
// adminAPI.md §6, §9 (п.3). Обработчики команд добавляются на шагах 2.3+.

import {
  closeDatabaseConnection,
  createLogger,
  ensureModelsInitialized,
  LOG_EVENTS,
} from '@nutrition-bot/shared';
import type { Server } from 'node:http';
import { createBot } from './bot.js';
import {
  ALLOWED_UPDATES,
  resolveBotMode,
  resolveBotPort,
  resolveBotToken,
  resolveWebhookConfig,
} from './config.js';
import { createWebhookServer } from './webhook-server.js';

export const SERVICE_NAME = 'bot';
export const logger = createLogger(SERVICE_NAME);

const bot = createBot(resolveBotToken(), logger);
const mode = resolveBotMode();

let webhookServer: Server | undefined;

async function startPolling(): Promise<void> {
  // Снимаем webhook (если был установлен ранее), иначе Telegram не отдаст
  // обновления через getUpdates — adminAPI.md §6.1 (deleteWebhook).
  await bot.api.deleteWebhook();

  logger.info(
    { event: LOG_EVENTS.SERVICE_STARTED, mode },
    `${SERVICE_NAME} service starting (long polling)`,
  );

  await bot.start({
    allowed_updates: [...ALLOWED_UPDATES],
    onStart: () => {
      logger.info('Long polling запущен');
    },
  });
}

async function startWebhook(): Promise<void> {
  const { url, secretToken } = resolveWebhookConfig();
  const path = new URL(url).pathname;
  const port = resolveBotPort();

  await bot.api.setWebhook(url, {
    secret_token: secretToken,
    allowed_updates: [...ALLOWED_UPDATES],
  });

  webhookServer = createWebhookServer(bot, { path, secretToken }, logger);
  await new Promise<void>((resolve) => webhookServer?.listen(port, resolve));

  logger.info(
    { event: LOG_EVENTS.SERVICE_STARTED, mode, port, path },
    `${SERVICE_NAME} service listening (webhook)`,
  );
}

async function main(): Promise<void> {
  ensureModelsInitialized();

  const me = await bot.api.getMe();
  logger.info({ botUsername: me.username, mode }, 'Токен бота проверен (getMe)');

  if (mode === 'webhook') {
    await startWebhook();
  } else {
    await startPolling();
  }
}

void main().catch((err: unknown) => {
  logger.fatal({ err }, `${SERVICE_NAME} service failed to start`);
  process.exit(1);
});

function shutdown(signal: string): void {
  logger.info({ signal }, `Shutting down ${SERVICE_NAME} service`);

  const stop = mode === 'webhook' ? stopWebhook() : bot.stop();

  void stop
    .then(() => closeDatabaseConnection())
    .then(() => {
      logger.info(`${SERVICE_NAME} service stopped`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      logger.error({ err }, 'Error while shutting down bot service');
      process.exit(1);
    });
}

function stopWebhook(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!webhookServer) {
      resolve();
      return;
    }
    webhookServer.close((err) => (err ? reject(err) : resolve()));
  });
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
