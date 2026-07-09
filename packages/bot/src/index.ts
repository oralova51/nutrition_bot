// Точка входа Telegram-бота: polling/webhook, обработка апдейтов.
// Регистрация бота и middleware добавляются на шагах 2.1–2.2.

import { createLogger, LOG_EVENTS } from '@nutrition-bot/shared';

export const SERVICE_NAME = 'bot';
export const logger = createLogger(SERVICE_NAME);

logger.info({ event: LOG_EVENTS.SERVICE_STARTED }, `${SERVICE_NAME} service initialized`);
