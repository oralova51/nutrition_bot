// Roadmap 5.8: вечерняя досылка medium/low рекомендаций в 20:00 по поясу клиента,
// один раз на рекомендацию.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nutrition-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nutrition-bot/shared')>();
  return {
    ...actual,
    Message: { count: vi.fn() },
    NotificationSettings: { findOne: vi.fn() },
    Recommendation: { findAll: vi.fn() },
    sendTelegramMessageWithRetry: vi.fn(),
  };
});

import {
  Message,
  NotificationSettings,
  Recommendation,
  sendTelegramMessageWithRetry,
} from '@nutrition-bot/shared';
import {
  makeClient,
  makeMessage,
  makeNotificationSettings,
  makeRecommendation,
  makeTestLogger,
} from '@nutrition-bot/shared/testing';
import { runRecommendationDeliveryJob } from './recommendation-delivery-job.js';

// 20:00 Europe/Kaliningrad = 18:00 UTC.
const AT_SLOT = new Date('2026-01-15T18:00:00.000Z');
const OFF_SLOT = new Date('2026-01-15T17:30:00.000Z');

function arrangeRecommendation(overrides: Parameters<typeof makeRecommendation>[0] = {}) {
  const recommendation = makeRecommendation(overrides);
  return Object.assign(recommendation, { client: makeClient() });
}

interface ArrangeOptions {
  alreadyDelivered?: boolean;
  settings?: Parameters<typeof makeNotificationSettings>[0] | null;
}

function arrange(options: ArrangeOptions = {}) {
  vi.mocked(Recommendation.findAll).mockResolvedValue([arrangeRecommendation()] as never);
  vi.mocked(NotificationSettings.findOne).mockResolvedValue(
    options.settings === null ? null : (makeNotificationSettings(options.settings) as never),
  );
  vi.mocked(Message.count).mockResolvedValue(options.alreadyDelivered ? 1 : 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(AT_SLOT);
  vi.mocked(sendTelegramMessageWithRetry).mockResolvedValue({
    telegramMessageId: 1,
    message: makeMessage(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runRecommendationDeliveryJob', () => {
  it('досылает рекомендацию в 20:00 и связывает Message с рекомендацией', async () => {
    arrange();

    await runRecommendationDeliveryJob(makeTestLogger());

    expect(vi.mocked(sendTelegramMessageWithRetry).mock.calls[0]?.[0]).toMatchObject({
      type: 'recommendation',
      category: 'optional',
      text: 'Попробуй добавить стакан воды к следующему приёму пищи.',
    });
    const result = (await vi.mocked(sendTelegramMessageWithRetry).mock.results[0]
      ?.value) as Awaited<ReturnType<typeof sendTelegramMessageWithRetry>>;
    expect(result.message.update).toHaveBeenCalledWith({ recommendationId: 'recommendation-1' });
  });

  it('выбирает только medium/low рекомендации со статусом sent', async () => {
    arrange();

    await runRecommendationDeliveryJob(makeTestLogger());

    expect(vi.mocked(Recommendation.findAll).mock.calls[0]?.[0]?.where).toMatchObject({
      status: 'sent',
    });
  });

  it('вне слота 20:00 не делает ни одного запроса', async () => {
    vi.setSystemTime(OFF_SLOT);
    arrange();

    await runRecommendationDeliveryJob(makeTestLogger());

    expect(Recommendation.findAll).not.toHaveBeenCalled();
    expect(NotificationSettings.findOne).not.toHaveBeenCalled();
    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
  });

  it('не путает 20:00 UTC с 20:00 у клиента', async () => {
    vi.setSystemTime(new Date('2026-01-15T20:00:00.000Z'));
    arrange();

    await runRecommendationDeliveryJob(makeTestLogger());

    expect(Recommendation.findAll).not.toHaveBeenCalled();
  });

  it('не досылает рекомендацию, которая уже ушла в Telegram', async () => {
    arrange({ alreadyDelivered: true });

    await runRecommendationDeliveryJob(makeTestLogger());

    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
  });

  it('идемпотентен: повторный запуск в том же слоте не дублирует отправку', async () => {
    arrange();
    await runRecommendationDeliveryJob(makeTestLogger());
    expect(sendTelegramMessageWithRetry).toHaveBeenCalledOnce();

    vi.mocked(Message.count).mockResolvedValue(1);
    await runRecommendationDeliveryJob(makeTestLogger());

    expect(sendTelegramMessageWithRetry).toHaveBeenCalledOnce();
  });

  it('уважает отключённые уведомления и отключённый тип recommendations', async () => {
    arrange({ settings: { enabled: false } });
    await runRecommendationDeliveryJob(makeTestLogger());

    arrange({ settings: { enabledTypes: ['diary'] } });
    await runRecommendationDeliveryJob(makeTestLogger());

    arrange({ settings: null });
    await runRecommendationDeliveryJob(makeTestLogger());

    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
  });

  it('сбой доставки логируется и не прерывает job', async () => {
    arrange();
    vi.mocked(sendTelegramMessageWithRetry).mockRejectedValue(new Error('Telegram недоступен'));

    const logger = makeTestLogger();
    await expect(runRecommendationDeliveryJob(logger)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledOnce();
  });
});
