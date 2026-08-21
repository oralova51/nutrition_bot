// Roadmap 4.14: ночной job создаёт pending-запись за вчерашний день клиента,
// если за этот день не было ни одной записи.

import { Op } from 'sequelize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nutrition-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nutrition-bot/shared')>();
  return {
    ...actual,
    Client: { findAll: vi.fn() },
    NutritionDiary: { count: vi.fn(), create: vi.fn() },
  };
});

import { Client, NutritionDiary } from '@nutrition-bot/shared';
import {
  makeClient,
  makeEnrollment,
  makeNotificationSettings,
  makeTestLogger,
} from '@nutrition-bot/shared/testing';
import { runPendingDiaryJob } from './pending-diary-job.js';

// Cron стоит на 00:30 UTC — это 02:30 16 января у клиента, «вчера» = 15 января.
const AT_CRON = new Date('2026-01-16T00:30:00.000Z');

function arrangeClient(id = 'client-1') {
  const client = makeClient({ id });
  return Object.assign(client, {
    notificationSettings: makeNotificationSettings({ clientId: id }),
    enrollments: [makeEnrollment({ id: `enrollment-${id}`, clientId: id })],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(AT_CRON);
  vi.mocked(Client.findAll).mockResolvedValue([arrangeClient()] as never);
  vi.mocked(NutritionDiary.count).mockResolvedValue(0);
  vi.mocked(NutritionDiary.create).mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runPendingDiaryJob', () => {
  it('создаёт pending-запись за вчерашний день клиента', async () => {
    await runPendingDiaryJob(makeTestLogger());

    expect(vi.mocked(NutritionDiary.create).mock.calls[0]?.[0]).toMatchObject({
      clientEnrollmentId: 'enrollment-client-1',
      clientId: 'client-1',
      status: 'pending',
      description: null,
      hasPhoto: false,
    });
  });

  it('считает «вчера» по локальным суткам клиента, а не по UTC', async () => {
    await runPendingDiaryJob(makeTestLogger());

    // 15 января в Europe/Kaliningrad (UTC+2): с 14-го 22:00 UTC до 15-го 21:59:59.999 UTC.
    const where = vi.mocked(NutritionDiary.count).mock.calls[0]?.[0]?.where as {
      mealAt: { [Op.between]: [Date, Date] };
    };
    const [start, end] = where.mealAt[Op.between];
    expect(start.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-15T21:59:59.999Z');

    // mealAt новой записи ставится на конец этого же дня.
    const created = vi.mocked(NutritionDiary.create).mock.calls[0]?.[0] as { mealAt: Date };
    expect(created.mealAt).toEqual(end);
  });

  it('не создаёт запись, если за день уже есть данные', async () => {
    vi.mocked(NutritionDiary.count).mockResolvedValue(1);

    await runPendingDiaryJob(makeTestLogger());

    expect(NutritionDiary.create).not.toHaveBeenCalled();
  });

  it('идемпотентен: повторный запуск видит созданную запись и ничего не добавляет', async () => {
    await runPendingDiaryJob(makeTestLogger());
    expect(NutritionDiary.create).toHaveBeenCalledOnce();

    vi.mocked(NutritionDiary.count).mockResolvedValue(1);
    await runPendingDiaryJob(makeTestLogger());

    expect(NutritionDiary.create).toHaveBeenCalledOnce();
  });

  it('ошибка на одном клиенте не мешает следующему', async () => {
    vi.mocked(Client.findAll).mockResolvedValue([
      arrangeClient('client-1'),
      arrangeClient('client-2'),
    ] as never);
    vi.mocked(NutritionDiary.create)
      .mockRejectedValueOnce(new Error('БД недоступна'))
      .mockResolvedValueOnce({});

    const logger = makeTestLogger();
    await runPendingDiaryJob(logger);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(NutritionDiary.create).toHaveBeenCalledTimes(2);
  });

  it('пропускает клиента без активного enrollment', async () => {
    vi.mocked(Client.findAll).mockResolvedValue([makeClient()] as never);

    await runPendingDiaryJob(makeTestLogger());

    expect(NutritionDiary.count).not.toHaveBeenCalled();
    expect(NutritionDiary.create).not.toHaveBeenCalled();
  });
});
