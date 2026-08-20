// Единый сервис отправки сообщений в Telegram.
// Используется и ботом, и scheduler. Пишет факт доставки в Message.
// Retry-политика: +5 мин, максимум 3 попытки (ФТ-4 / ФТ-5, roadmap 4.7).

import { logMessageDeliveryFailure } from '../logging/events.js';
import { createLogger } from '../logging/logger.js';
import { LOG_EVENTS } from '../logging/types.js';
import { Message, type MessageCategory, type MessageType } from '../models/message.js';
import { sendAdminAlert } from './alerts.js';
import { getBot } from './bot.js';

const logger = createLogger('telegram-sender');

const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;

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
): void {
  logMessageDeliveryFailure(logger, {
    clientId: payload.clientId,
    messageId: message.id,
    channel: 'telegram',
    retryCount,
    err,
  });

  void sendAdminAlert(
    `❌ Сообщение не доставлено\n\n` +
      `Client: ${payload.clientId}\n` +
      `Message: ${message.id}\n` +
      `Type: ${payload.type}\n` +
      `Retry: ${retryCount}/${MAX_RETRIES}\n` +
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
    const nextRetryCount = retryCount + 1;
    await message.update({ retryCount: nextRetryCount });
    logMessageDeliveryFailure(logger, {
      clientId: payload.clientId,
      messageId: message.id,
      channel: 'telegram',
      retryCount: nextRetryCount,
      err,
    });

    if (nextRetryCount >= MAX_RETRIES) {
      await message.update({ deliveryStatus: 'delivery_failed' });
      alertAdminOnDeliveryFailure(message, payload, nextRetryCount, err);
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
