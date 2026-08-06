// Имена сервисов монорепо — попадают в поле `service` каждой log-строки.

export const SERVICE_NAMES = [
  'api',
  'bot',
  'scheduler',
  'telegram-sender',
  'nutrition-diary',
  'ai-engine',
] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

export const LOG_EVENTS = {
  SERVICE_STARTED: 'service.started',
  MESSAGE_DELIVERY_FAILED: 'message.delivery_failed',
  AI_ENGINE_ERROR: 'ai_engine.error',
} as const;

export type LogEvent = (typeof LOG_EVENTS)[keyof typeof LOG_EVENTS];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
