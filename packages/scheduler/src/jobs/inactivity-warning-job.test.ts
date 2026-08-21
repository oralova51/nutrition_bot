// ФТ-9: предупреждение о неактивности — порог 48 ч, слот 10:00 по поясу клиента,
// одно предупреждение на период молчания.

import { Op } from 'sequelize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nutrition-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nutrition-bot/shared')>();
  return {
    ...actual,
    Client: { findAll: vi.fn() },
    Message: { count: vi.fn() },
    sendTelegramMessageWithRetry: vi.fn(),
  };
});

import { Client, Message, sendTelegramMessageWithRetry } from '@nutrition-bot/shared';
import {
  makeClient,
  makeEnrollment,
  makeNotificationSettings,
  makeTestLogger,
} from '@nutrition-bot/shared/testing';
import { runInactivityWarningJob } from './inactivity-warning-job.js';

// 10:00 Europe/Kaliningrad = 08:00 UTC.
const AT_SLOT = new Date('2026-01-15T08:00:00.000Z');
const OFF_SLOT = new Date('2026-01-15T08:30:00.000Z');
const LAST_INTERACTION = new Date('2026-01-12T08:00:00.000Z');

function arrangeClient(lastInteractionAt: Date | null = LAST_INTERACTION) {
  const client = makeClient({ lastInteractionAt });
  return Object.assign(client, {
    notificationSettings: makeNotificationSettings({ clientId: client.id }),
    enrollments: [makeEnrollment({ clientId: client.id })],
  });
}

function arrange(options: { alreadyWarned?: boolean; lastInteractionAt?: Date | null } = {}) {
  const lastInteractionAt =
    'lastInteractionAt' in options ? options.lastInteractionAt : LAST_INTERACTION;
  vi.mocked(Client.findAll).mockResolvedValue([arrangeClient(lastInteractionAt ?? null)] as never);
  vi.mocked(Message.count).mockResolvedValue(options.alreadyWarned ? 1 : 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(AT_SLOT);
  vi.mocked(sendTelegramMessageWithRetry).mockResolvedValue({ telegramMessageId: 1 } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runInactivityWarningJob', () => {
  it('отправляет предупреждение в 10:00 по поясу клиента', async () => {
    arrange();

    await runInactivityWarningJob(makeTestLogger());

    expect(vi.mocked(sendTelegramMessageWithRetry).mock.calls[0]?.[0]).toMatchObject({
      type: 'inactivity_warning',
      category: 'optional',
    });
  });

  it('молчит вне слота 10:00', async () => {
    vi.setSystemTime(OFF_SLOT);
    arrange();

    await runInactivityWarningJob(makeTestLogger());

    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
    expect(Message.count).not.toHaveBeenCalled();
  });

  it('выбирает клиентов, молчащих больше 48 часов', async () => {
    arrange();

    await runInactivityWarningJob(makeTestLogger());

    const where = vi.mocked(Client.findAll).mock.calls[0]?.[0]?.where as {
      lastInteractionAt: { [Op.lt]: Date };
    };
    expect(where.lastInteractionAt[Op.lt].toISOString()).toBe('2026-01-13T08:00:00.000Z');
  });

  it('не повторяет предупреждение за тот же период молчания', async () => {
    arrange({ alreadyWarned: true });

    await runInactivityWarningJob(makeTestLogger());

    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
  });

  it('ищет прежнее предупреждение только после последнего взаимодействия', async () => {
    arrange();

    await runInactivityWarningJob(makeTestLogger());

    const where = vi.mocked(Message.count).mock.calls[0]?.[0]?.where as {
      type: string;
      createdAt: { [Op.gt]: Date };
    };
    expect(where.type).toBe('inactivity_warning');
    expect(where.createdAt[Op.gt]).toEqual(LAST_INTERACTION);
  });

  it('без lastInteractionAt проверяет наличие предупреждения без границы по времени', async () => {
    arrange({ lastInteractionAt: null });

    await runInactivityWarningJob(makeTestLogger());

    const where = vi.mocked(Message.count).mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.createdAt).toBeUndefined();
  });

  it('сбой доставки логируется и не прерывает job', async () => {
    arrange();
    vi.mocked(sendTelegramMessageWithRetry).mockRejectedValue(new Error('Telegram недоступен'));

    const logger = makeTestLogger();
    await expect(runInactivityWarningJob(logger)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledOnce();
  });
});
