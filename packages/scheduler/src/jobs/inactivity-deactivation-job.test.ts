// ФТ-10: автоотключение уведомлений после 72 ч молчания + лог деактивации.

import { Op } from 'sequelize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nutrition-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nutrition-bot/shared')>();
  return {
    ...actual,
    Client: { findAll: vi.fn() },
    Message: { create: vi.fn() },
  };
});

import { Client, Message } from '@nutrition-bot/shared';
import {
  makeClient,
  makeEnrollment,
  makeNotificationSettings,
  makeTestLogger,
} from '@nutrition-bot/shared/testing';
import { runInactivityDeactivationJob } from './inactivity-deactivation-job.js';

const NOW = new Date('2026-01-15T08:00:00.000Z');

function arrangeClient(id = 'client-1') {
  const client = makeClient({ id, lastInteractionAt: new Date('2026-01-10T08:00:00.000Z') });
  return Object.assign(client, {
    notificationSettings: makeNotificationSettings({ clientId: id }),
    enrollments: [makeEnrollment({ clientId: id })],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(Message.create).mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runInactivityDeactivationJob', () => {
  it('отключает уведомления с причиной inactivity и пишет лог деактивации', async () => {
    const client = arrangeClient();
    vi.mocked(Client.findAll).mockResolvedValue([client] as never);

    await runInactivityDeactivationJob(makeTestLogger());

    expect(client.notificationSettings.update).toHaveBeenCalledWith({
      enabled: false,
      disabledReason: 'inactivity',
    });
    expect(client.notificationSettings.enabled).toBe(false);
    expect(vi.mocked(Message.create).mock.calls[0]?.[0]).toMatchObject({
      clientId: 'client-1',
      type: 'info',
      category: 'transactional',
    });
  });

  it('выбирает клиентов, молчащих больше 72 часов', async () => {
    vi.mocked(Client.findAll).mockResolvedValue([]);

    await runInactivityDeactivationJob(makeTestLogger());

    const where = vi.mocked(Client.findAll).mock.calls[0]?.[0]?.where as {
      lastInteractionAt: { [Op.lt]: Date };
    };
    expect(where.lastInteractionAt[Op.lt].toISOString()).toBe('2026-01-12T08:00:00.000Z');
  });

  it('идемпотентен: уже отключённые клиенты не попадают в выборку', async () => {
    vi.mocked(Client.findAll).mockResolvedValue([]);

    await runInactivityDeactivationJob(makeTestLogger());

    const include = vi.mocked(Client.findAll).mock.calls[0]?.[0]?.include as Array<{
      as: string;
      where?: Record<string, unknown>;
    }>;
    const settingsInclude = include.find((item) => item.as === 'notificationSettings');
    expect(settingsInclude?.where).toMatchObject({ enabled: true });
    expect(Message.create).not.toHaveBeenCalled();
  });

  it('ошибка на одном клиенте не мешает следующему', async () => {
    const failing = arrangeClient('client-1');
    const healthy = arrangeClient('client-2');
    failing.notificationSettings.update.mockRejectedValueOnce(new Error('БД недоступна'));
    vi.mocked(Client.findAll).mockResolvedValue([failing, healthy] as never);

    const logger = makeTestLogger();
    await runInactivityDeactivationJob(logger);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(healthy.notificationSettings.update).toHaveBeenCalledOnce();
    expect(Message.create).toHaveBeenCalledOnce();
  });
});
