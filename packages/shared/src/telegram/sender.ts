// Единый сервис отправки сообщений в Telegram.
// Используется и ботом, и scheduler. Пишет факт доставки в Message.
// Retry-политика: +5 мин, максимум 3 попытки (ФТ-4 / ФТ-5, roadmap 4.7).
// Постоянные ошибки Telegram (400 chat not found, 403 blocked) не ретраятся.

import { Op } from 'sequelize';
import { logMessageDeliveryFailure } from '../logging/events.js';
import { createLogger } from '../logging/logger.js';
import { LOG_EVENTS } from '../logging/types.js';
import { Message, type MessageCategory, type MessageType } from '../models/message.js';
import { sendAdminAlert } from './alerts.js';
import { getBot } from './bot.js';
import { stripTelegramHtml } from './html.js';

const logger = createLogger('telegram-sender');

const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;
/**
 * Коды, которые не чинятся повтором той же sendMessage.
 * 400 специально НЕ входит: туда же попадают «can't parse entities» и «message is too long»
 * у HTML-сводок нейронки — это ошибка разметки, а не мёртвый чат.
 */
const PERMANENT_TELEGRAM_ERROR_CODES = new Set([401, 403, 404]);
const DELIVERY_FAILURE_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const lastDeliveryFailureAlertAt = new Map<string, number>();

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
 * пользователь деактивирован. Сетевые сбои, 429/5xx и битый HTML — нет.
 */
export function isPermanentTelegramError(err: unknown): boolean {
  const text = formatError(err).toLowerCase();
  if (PERMANENT_ERROR_TEXT_MARKERS.some((marker) => text.includes(marker))) {
    return true;
  }

  const code = getTelegramErrorCode(err);
  return code !== undefined && PERMANENT_TELEGRAM_ERROR_CODES.has(code);
}

export function isTelegramHtmlParseError(err: unknown): boolean {
  const text = formatError(err).toLowerCase();
  return text.includes("can't parse entities") || text.includes('cannot parse entities');
}

/**
 * Клиент уже исчерпал retry за окно кулдауна (chat not found / blocked и т.п.).
 * Нужно, чтобы job'ы не долбили тот же чат каждые 2 минуты, а дедуп алерта
 * переживал рестарт процесса (`tsx watch` обнуляет in-memory Map).
 */
export async function clientHasRecentDeliveryFailure(
  clientId: string,
  excludeMessageId?: string,
): Promise<boolean> {
  const since = new Date(Date.now() - DELIVERY_FAILURE_ALERT_COOLDOWN_MS);
  const previous = await Message.findOne({
    where: {
      clientId,
      deliveryStatus: 'delivery_failed',
      retryCount: MAX_RETRIES,
      createdAt: { [Op.gte]: since },
      ...(excludeMessageId ? { id: { [Op.ne]: excludeMessageId } } : {}),
    },
    attributes: ['id'],
  });
  return previous !== null;
}

async function shouldAlertAdminOnDeliveryFailure(
  clientId: string,
  messageId: string,
): Promise<boolean> {
  const now = Date.now();
  const last = lastDeliveryFailureAlertAt.get(clientId);
  if (last !== undefined && now - last < DELIVERY_FAILURE_ALERT_COOLDOWN_MS) {
    return false;
  }

  if (await clientHasRecentDeliveryFailure(clientId, messageId)) {
    lastDeliveryFailureAlertAt.set(clientId, now);
    return false;
  }

  lastDeliveryFailureAlertAt.set(clientId, now);
  return true;
}

/** Сброс in-memory cooldown алертов — только для unit-тестов. */
export function resetPermanentDeliveryAlertCooldown(): void {
  lastDeliveryFailureAlertAt.clear();
}

async function dispatchTelegramMessage(
  payload: TelegramMessagePayload,
  text: string,
  parseMode: TelegramParseMode | undefined,
): Promise<{ message_id: number }> {
  return getBot().api.sendMessage(payload.telegramId, text, {
    ...(parseMode ? { parse_mode: parseMode } : {}),
    ...(payload.replyMarkup ? { reply_markup: payload.replyMarkup } : {}),
  });
}

async function sendOrStripHtml(payload: TelegramMessagePayload): Promise<{ message_id: number }> {
  const parseMode = payload.parseMode ?? 'HTML';
  try {
    return await dispatchTelegramMessage(payload, payload.text, parseMode);
  } catch (err) {
    if (!isTelegramHtmlParseError(err)) {
      throw err;
    }
    logger.warn(
      { clientId: payload.clientId, type: payload.type },
      'Telegram отверг HTML — отправляем ту же сводку без разметки',
    );
    return dispatchTelegramMessage(payload, stripTelegramHtml(payload.text), undefined);
  }
}

/** Базовая отправка без retry. Используется в боте для ответов в реальном времени. */
export async function sendTelegramMessage(
  payload: TelegramMessagePayload,
): Promise<TelegramSendResult> {
  const message = await createPendingMessage(payload, 0);

  try {
    const telegramMessage = await sendOrStripHtml(payload);
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
    const telegramMessage = await sendOrStripHtml(payload);
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
      if (await shouldAlertAdminOnDeliveryFailure(payload.clientId, message.id)) {
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
