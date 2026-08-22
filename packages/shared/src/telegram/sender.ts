// Единый сервис отправки сообщений в Telegram.
// Используется и ботом, и scheduler. Пишет факт доставки в Message.
// Retry-политика: +5 мин, максимум 3 попытки (ФТ-4 / ФТ-5, roadmap 4.7).
// Постоянные ошибки Telegram (400 chat not found, 403 blocked) не ретраятся.

import { logMessageDeliveryFailure } from '../logging/events.js';
import { createLogger } from '../logging/logger.js';
import { LOG_EVENTS } from '../logging/types.js';
import { Message, type MessageCategory, type MessageType } from '../models/message.js';
import { sendAdminAlert } from './alerts.js';
import { getBot } from './bot.js';

const logger = createLogger('telegram-sender');

const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;
/** 400/401/403/404 Telegram не «чинятся» повтором той же sendMessage. */
const PERMANENT_TELEGRAM_ERROR_CODES = new Set([400, 401, 403, 404]);
const PERMANENT_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const lastPermanentAlertAt = new Map<string, number>();

const PERMANENT_ERROR_TEXT_MARKERS = [
  'chat not found',
  'bot was blocked',
  'user is deactivated',
  'bot was kicked',
  'peer_id_invalid',
  'forbidden: bot was blocked by the user',
];

export type TelegramParseMode = 'HTML' | 'Markdown' | 'MarkdownV2';

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TelegramMessagePayload {
  telegramId: string;
  text: string;
  clientId: string;
  type: MessageType;
  category: MessageCategory;
  parseMode?: TelegramParseMode;
  replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] };
}

export interface TelegramSendResult {
  telegramMessageId: number;
  message: Message;
}

/** Создаёт запись Message в БД до отправки. */
async function createPendingMessage(
  payload: TelegramMessagePayload,
  retryCount: number,
): Promise<Message> {
  return Message.create({
    clientId: payload.clientId,
    type: payload.type,
    category: payload.category,
    content: payload.text,
    channel: 'telegram',
    deliveryStatus: 'sent',
    retryCount,
  });
}

/**
 * Логирует сбой доставки и отправляет алерт администратору (best-effort).
 * Вызывается только при исчерпании retry: единичные сбои не должны его будить.
 */
function alertAdminOnDeliveryFailure(
  message: Message,
  payload: TelegramMessagePayload,
  retryCount: number,
  err: unknown,
  permanent: boolean,
): void {
  logMessageDeliveryFailure(logger, {
    clientId: payload.clientId,
    messageId: message.id,
    channel: 'telegram',
    retryCount,
    err,
  });

  const permanentHint = permanent
    ? 'Постоянная ошибка Telegram — повторных попыток не будет.\n'
    : '';

  void sendAdminAlert(
    `❌ Сообщение не доставлено\n\n` +
      `Client: ${payload.clientId}\n` +
      `Message: ${message.id}\n` +
      `Type: ${payload.type}\n` +
      `Retry: ${retryCount}/${MAX_RETRIES}\n` +
      permanentHint +
      `Ошибка: ${formatError(err)}`,
  ).catch((alertErr: unknown) => {
    logger.warn(
      { alertErr, event: LOG_EVENTS.MESSAGE_DELIVERY_FAILED },
      'Не удалось отправить алерт администратору о сбое доставки',
    );
  });
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return String(err);
}

function getTelegramErrorCode(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('error_code' in err)) {
    return undefined;
  }
  const code = err.error_code;
  if (typeof code !== 'number' || !Number.isInteger(code)) {
    return undefined;
  }
  return code;
}

/**
 * Ошибки, которые не имеет смысла ретраить: чат не найден, бот заблокирован,
 * пользователь деактивирован. Сетевые сбои и 429/5xx — нет.
 */
export function isPermanentTelegramError(err: unknown): boolean {
  const code = getTelegramErrorCode(err);
  if (code !== undefined && PERMANENT_TELEGRAM_ERROR_CODES.has(code)) {
    return true;
  }

  const text = formatError(err).toLowerCase();
  return PERMANENT_ERROR_TEXT_MARKERS.some((marker) => text.includes(marker));
}

function shouldAlertAdminOnPermanentError(clientId: string): boolean {
  const now = Date.now();
  const last = lastPermanentAlertAt.get(clientId);
  if (last !== undefined && now - last < PERMANENT_ALERT_COOLDOWN_MS) {
    return false;
  }
  lastPermanentAlertAt.set(clientId, now);
  return true;
}

/** Сброс in-memory cooldown алертов — только для unit-тестов. */
export function resetPermanentDeliveryAlertCooldown(): void {
  lastPermanentAlertAt.clear();
}

/** Базовая отправка без retry. Используется в боте для ответов в реальном времени. */
export async function sendTelegramMessage(
  payload: TelegramMessagePayload,
): Promise<TelegramSendResult> {
  const message = await createPendingMessage(payload, 0);

  try {
    const telegramMessage = await getBot().api.sendMessage(payload.telegramId, payload.text, {
      parse_mode: payload.parseMode ?? 'HTML',
      ...(payload.replyMarkup ? { reply_markup: payload.replyMarkup } : {}),
    });
    return { telegramMessageId: telegramMessage.message_id, message };
  } catch (err) {
    await message.update({ deliveryStatus: 'delivery_failed', retryCount: 0 });
    // Личный алерт администратору здесь не шлём: это ответ в реальном времени без
    // ретраев, и единичный сбой не повод его будить. Массовые сбои ловит отдельный
    // job по количеству delivery_failed за окно (roadmap 10.8).
    logMessageDeliveryFailure(logger, {
      clientId: payload.clientId,
      messageId: message.id,
      channel: 'telegram',
      retryCount: 0,
      err,
    });
    throw err;
  }
}

/** Отправка с retry: +5 мин, максимум 3 попытки. Используется в scheduler. */
export async function sendTelegramMessageWithRetry(
  payload: TelegramMessagePayload,
): Promise<TelegramSendResult> {
  const message = await createPendingMessage(payload, 0);
  return sendWithRetry(payload, message, 0);
}

async function sendWithRetry(
  payload: TelegramMessagePayload,
  message: Message,
  retryCount: number,
): Promise<TelegramSendResult> {
  try {
    const telegramMessage = await getBot().api.sendMessage(payload.telegramId, payload.text, {
      parse_mode: payload.parseMode ?? 'HTML',
      ...(payload.replyMarkup ? { reply_markup: payload.replyMarkup } : {}),
    });
    return { telegramMessageId: telegramMessage.message_id, message };
  } catch (err) {
    const permanent = isPermanentTelegramError(err);
    const nextRetryCount = permanent ? MAX_RETRIES : retryCount + 1;
    await message.update({ retryCount: nextRetryCount });
    logMessageDeliveryFailure(logger, {
      clientId: payload.clientId,
      messageId: message.id,
      channel: 'telegram',
      retryCount: nextRetryCount,
      err,
    });

    if (permanent || nextRetryCount >= MAX_RETRIES) {
      await message.update({ deliveryStatus: 'delivery_failed' });
      const alertAdmin = !permanent || shouldAlertAdminOnPermanentError(payload.clientId);
      if (alertAdmin) {
        alertAdminOnDeliveryFailure(message, payload, nextRetryCount, err, permanent);
      }
      throw err;
    }

    logger.info(
      { clientId: payload.clientId, messageId: message.id, retryCount: nextRetryCount },
      'Планируем retry отправки через Telegram',
    );

    await sleep(RETRY_DELAY_MS);
    return sendWithRetry(payload, message, nextRetryCount);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
