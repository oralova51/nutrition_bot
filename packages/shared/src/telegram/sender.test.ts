// Тесты доставки в Telegram (ФТ-21): ретраи 3×5 мин, статус delivery_failed
// и алерт администратору только при исчерпании попыток.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./bot.js', () => ({ getBot: vi.fn() }));
vi.mock('./alerts.js', () => ({ sendAdminAlert: vi.fn() }));
vi.mock('../models/message.js', () => ({ Message: { create: vi.fn() } }));
vi.mock('../logging/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { Message } from '../models/message.js';
import { makeMessage } from '../testing/factories.js';
import { sendAdminAlert } from './alerts.js';
import { getBot } from './bot.js';
import {
  isPermanentTelegramError,
  resetPermanentDeliveryAlertCooldown,
  sendTelegramMessage,
  sendTelegramMessageWithRetry,
  type TelegramMessagePayload,
} from './sender.js';

const RETRY_DELAY_MS = 5 * 60 * 1000;

const payload: TelegramMessagePayload = {
  telegramId: '100200300',
  text: 'Пора заполнить дневник 🍽️',
  clientId: 'client-1',
  type: 'reminder',
  category: 'optional',
};

let sendMessage: ReturnType<typeof vi.fn>;
let record: ReturnType<typeof makeMessage>;

function telegramApiError(
  errorCode: number,
  description: string,
): Error & { error_code: number; description: string } {
  const err = new Error(`Call to 'sendMessage' failed! (${errorCode}: ${description})`) as Error & {
    error_code: number;
    description: string;
  };
  err.name = 'GrammyError';
  err.error_code = errorCode;
  err.description = description;
  return err;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  resetPermanentDeliveryAlertCooldown();

  record = makeMessage({ deliveryStatus: 'sent', retryCount: 0 });
  sendMessage = vi.fn().mockResolvedValue({ message_id: 555 });

  vi.mocked(getBot).mockReturnValue({ api: { sendMessage } } as unknown as ReturnType<
    typeof getBot
  >);
  vi.mocked(Message.create).mockResolvedValue(record);
  vi.mocked(sendAdminAlert).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sendTelegramMessage', () => {
  it('сохраняет Message и возвращает id доставленного сообщения', async () => {
    const result = await sendTelegramMessage(payload);

    expect(Message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        type: 'reminder',
        category: 'optional',
        channel: 'telegram',
        deliveryStatus: 'sent',
        retryCount: 0,
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith('100200300', payload.text, { parse_mode: 'HTML' });
    expect(result.telegramMessageId).toBe(555);
    expect(record.update).not.toHaveBeenCalled();
  });

  it('прокидывает parse_mode и клавиатуру в Telegram API', async () => {
    await sendTelegramMessage({
      ...payload,
      parseMode: 'MarkdownV2',
      replyMarkup: { inline_keyboard: [[{ text: 'Да', callback_data: 'renewal:yes' }]] },
    });

    expect(sendMessage).toHaveBeenCalledWith('100200300', payload.text, {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: [[{ text: 'Да', callback_data: 'renewal:yes' }]] },
    });
  });

  it('помечает сообщение delivery_failed и пробрасывает ошибку', async () => {
    sendMessage.mockRejectedValue(new Error('Telegram недоступен'));

    await expect(sendTelegramMessage(payload)).rejects.toThrow('Telegram недоступен');

    expect(record.update).toHaveBeenCalledWith({
      deliveryStatus: 'delivery_failed',
      retryCount: 0,
    });
    expect(record.deliveryStatus).toBe('delivery_failed');
  });

  it('не будит администратора при единичном сбое: это работа job-а массовых сбоев', async () => {
    sendMessage.mockRejectedValue(new Error('Telegram недоступен'));

    await expect(sendTelegramMessage(payload)).rejects.toThrow('Telegram недоступен');

    expect(sendAdminAlert).not.toHaveBeenCalled();
  });
});

describe('sendTelegramMessageWithRetry', () => {
  it('не повторяет попытку, если сообщение ушло сразу', async () => {
    const result = await sendTelegramMessageWithRetry(payload);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(result.telegramMessageId).toBe(555);
    expect(record.retryCount).toBe(0);
    expect(record.deliveryStatus).toBe('sent');
  });

  it('повторяет попытку ровно через 5 минут и переиспользует ту же запись Message', async () => {
    sendMessage
      .mockRejectedValueOnce(new Error('таймаут'))
      .mockResolvedValueOnce({ message_id: 777 });

    const promise = sendTelegramMessageWithRetry(payload);

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS - 1);
    expect(sendMessage).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result.telegramMessageId).toBe(777);
    expect(Message.create).toHaveBeenCalledOnce();
    expect(record.retryCount).toBe(1);
    expect(record.deliveryStatus).toBe('sent');
  });

  it('после третьей неудачи ставит delivery_failed и алертит администратора', async () => {
    sendMessage.mockRejectedValue(new Error('Telegram недоступен'));

    const promise = sendTelegramMessageWithRetry(payload);
    const rejects = expect(promise).rejects.toThrow('Telegram недоступен');

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await rejects;

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(record.retryCount).toBe(3);
    expect(record.deliveryStatus).toBe('delivery_failed');
    expect(sendAdminAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAdminAlert).mock.calls[0]?.[0]).toContain('Retry: 3/3');
  });

  it('читаемо описывает в алерте ошибку, брошенную не через Error', async () => {
    sendMessage.mockRejectedValue('соединение разорвано');

    const promise = sendTelegramMessageWithRetry(payload);
    const rejects = expect(promise).rejects.toBe('соединение разорвано');

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await rejects;

    expect(vi.mocked(sendAdminAlert).mock.calls[0]?.[0]).toContain('соединение разорвано');
  });

  it('не подменяет исходную ошибку, если алерт администратору тоже не ушёл', async () => {
    sendMessage.mockRejectedValue(new Error('Telegram недоступен'));
    vi.mocked(sendAdminAlert).mockRejectedValue(new Error('администратор недоступен'));

    const promise = sendTelegramMessageWithRetry(payload);
    const rejects = expect(promise).rejects.toThrow('Telegram недоступен');

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await rejects;

    expect(record.deliveryStatus).toBe('delivery_failed');
  });

  it('не ретраит постоянную ошибку chat not found и алертит сразу', async () => {
    sendMessage.mockRejectedValue(telegramApiError(400, 'Bad Request: chat not found'));

    await expect(sendTelegramMessageWithRetry(payload)).rejects.toThrow('chat not found');

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(record.retryCount).toBe(3);
    expect(record.deliveryStatus).toBe('delivery_failed');
    expect(sendAdminAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAdminAlert).mock.calls[0]?.[0]).toContain(
      'Постоянная ошибка Telegram — повторных попыток не будет.',
    );
  });

  it('не спамит администратора повторным chat not found по тому же клиенту', async () => {
    sendMessage.mockRejectedValue(telegramApiError(400, 'Bad Request: chat not found'));

    await expect(sendTelegramMessageWithRetry(payload)).rejects.toThrow('chat not found');
    record = makeMessage({ deliveryStatus: 'sent', retryCount: 0 });
    vi.mocked(Message.create).mockResolvedValue(record);
    await expect(sendTelegramMessageWithRetry(payload)).rejects.toThrow('chat not found');

    expect(sendAdminAlert).toHaveBeenCalledOnce();
  });

  it('ретраит 429 Too Many Requests как временный сбой', async () => {
    sendMessage.mockRejectedValue(telegramApiError(429, 'Too Many Requests: retry after 60'));

    const promise = sendTelegramMessageWithRetry(payload);
    const rejects = expect(promise).rejects.toThrow('Too Many Requests');

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await rejects;

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendAdminAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAdminAlert).mock.calls[0]?.[0]).not.toContain('Постоянная ошибка');
  });
});

describe('isPermanentTelegramError', () => {
  it('узнаёт chat not found по тексту, даже без error_code', () => {
    expect(
      isPermanentTelegramError(
        new Error("Call to 'sendMessage' failed! (400: Bad Request: chat not found)"),
      ),
    ).toBe(true);
  });

  it('не считает сетевой сбой постоянным', () => {
    expect(isPermanentTelegramError(new Error('Telegram недоступен'))).toBe(false);
  });
});
