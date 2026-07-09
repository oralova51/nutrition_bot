// Точка входа планировщика: cron/BullMQ, выборка клиентов по слотам.
// Выбор движка и job-ы добавляются на шагах 4.1 и далее.

import { createLogger, LOG_EVENTS } from '@nutrition-bot/shared';

export const SERVICE_NAME = 'scheduler';
export const logger = createLogger(SERVICE_NAME);

logger.info({ event: LOG_EVENTS.SERVICE_STARTED }, `${SERVICE_NAME} service initialized`);
