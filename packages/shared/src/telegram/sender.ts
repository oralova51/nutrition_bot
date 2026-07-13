// Единый сервис отправки сообщений в Telegram.
// Используется и ботом, и scheduler. Пишет факт доставки в Message.
// Retry-политика: +5 мин, максимум 3 попытки (ФТ-4 / ФТ-5, roadmap 4.7).

import { Bot } from 'grammy';
import { logMessageDeliveryFailure } from '../logging/events.js';
import { createLogger } from '../logging/logger.js';
import { Message, type MessageCategory, type MessageType } from '../models/message.js';

const logger = createLogger('telegram-sender');

const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;

export type TelegramParseMode = 'HTML' | 'Markdown' | 'MarkdownV2';

export interface TelegramMessagePayload {
  telegramId: string;
  text: string;
  clientId: string;
  type: MessageType;
  category: MessageCategory;
  parseMode?: TelegramParseMode;
}

export interface TelegramSendResult {
  telegramMessageId: number;
  message: Message;
}

let botInstance: Bot | undefined;

function getBot(): Bot {
  if (!botInstance) {
    const token = process.env.TELEGRAM_API;
    if (!token) {
      throw new Error('TELEGRAM_API не задан. Укажите переменную окружения (см. .env.example).');
    }
    botInstance = new Bot(token);
  }
  return botInstance;
}

/** Создаёт запись Message в БД до отправки, затем обновляет статус. */
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

/** Базовая отправка без retry. Используется в боте для ответов в реальном времени. */
export async function sendTelegramMessage(
  payload: TelegramMessagePayload,
): Promise<TelegramSendResult> {
  const message = await createPendingMessage(payload, 0);

  try {
    const telegramMessage = await getBot().api.sendMessage(payload.telegramId, payload.text, {
      parse_mode: payload.parseMode ?? 'HTML',
    });
    return { telegramMessageId: telegramMessage.message_id, message };
  } catch (err) {
    await message.update({ deliveryStatus: 'delivery_failed' });
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
  retryCount = 0,
): Promise<TelegramSendResult> {
  const message = await createPendingMessage(payload, retryCount);

  try {
    const telegramMessage = await getBot().api.sendMessage(payload.telegramId, payload.text, {
      parse_mode: payload.parseMode ?? 'HTML',
    });
    return { telegramMessageId: telegramMessage.message_id, message };
  } catch (err) {
    const nextRetryCount = retryCount + 1;
    await message.update({ deliveryStatus: 'delivery_failed', retryCount: nextRetryCount });
    logMessageDeliveryFailure(logger, {
      clientId: payload.clientId,
      messageId: message.id,
      channel: 'telegram',
      retryCount: nextRetryCount,
      err,
    });

    if (nextRetryCount >= MAX_RETRIES) {
      throw err;
    }

    logger.info(
      { clientId: payload.clientId, messageId: message.id, retryCount: nextRetryCount },
      'Планируем retry отправки через Telegram',
    );

    await sleep(RETRY_DELAY_MS);
    return sendTelegramMessageWithRetry(payload, nextRetryCount);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
