// Фабрика структурированных логгеров (JSON, pino).
// nonFR §6: единый формат для сбоев доставки и ошибок AI Engine.

import pino, { type Logger } from 'pino';
import { LOG_LEVELS, type LogLevel, type ServiceName } from './types.js';

const loggers = new Map<ServiceName, Logger>();

const REDACT_PATHS = [
  'password',
  'token',
  'authorization',
  'DATABASE_URL',
  'TELEGRAM_API',
  '*.password',
  '*.token',
  '*.authorization',
  'req.headers.authorization',
];

function resolveLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw && (LOG_LEVELS as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  return 'info';
}

/** Создаёт (или возвращает кэшированный) логгер сервиса с полем `service` в каждой записи. */
export function createLogger(service: ServiceName): Logger {
  const cached = loggers.get(service);
  if (cached) {
    return cached;
  }

  const logger = pino({
    level: resolveLogLevel(),
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: REDACT_PATHS,
      censor: '[Redacted]',
    },
  });

  loggers.set(service, logger);
  return logger;
}

/** Сброс кэша — только для тестов. */
export function resetLoggersForTests(): void {
  loggers.clear();
}
