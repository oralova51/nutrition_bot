// Типизированные хелперы для ключевых событий мониторинга (nonFR §6).

import type { Logger } from 'pino';
import type { MessageChannel } from '../models/message.js';
import { LOG_EVENTS } from './types.js';

export interface MessageDeliveryFailureContext {
  clientId: string;
  messageId?: string;
  channel: MessageChannel;
  retryCount?: number;
  err?: unknown;
}

/** Логирует сбой доставки сообщения (ФТ-21, nonFR §6). */
export function logMessageDeliveryFailure(
  logger: Logger,
  context: MessageDeliveryFailureContext,
): void {
  const { err, ...fields } = context;

  logger.error(
    {
      event: LOG_EVENTS.MESSAGE_DELIVERY_FAILED,
      ...fields,
      ...(err !== undefined ? { err } : {}),
    },
    'Message delivery failed',
  );
}

export interface AiEngineErrorContext {
  clientId?: string;
  nutritionDiaryId?: string;
  questionnaireId?: string;
  modelVersion?: string;
  err: unknown;
}

/** Логирует ошибку AI Engine (nonFR §6). */
export function logAiEngineError(logger: Logger, context: AiEngineErrorContext): void {
  const { err, ...fields } = context;

  logger.error(
    {
      event: LOG_EVENTS.AI_ENGINE_ERROR,
      ...fields,
      err,
    },
    'AI Engine error',
  );
}
