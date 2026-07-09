// Точка входа сервиса API (admin + internal endpoints).
// HTTP-сервер, health-check и роуты добавляются на шагах 1.10 и далее.

import { createLogger, LOG_EVENTS } from '@nutrition-bot/shared';

export const SERVICE_NAME = 'api';
export const logger = createLogger(SERVICE_NAME);

logger.info({ event: LOG_EVENTS.SERVICE_STARTED }, `${SERVICE_NAME} service initialized`);
