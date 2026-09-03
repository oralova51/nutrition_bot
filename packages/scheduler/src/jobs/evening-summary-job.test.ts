// ФТ-24: job вечерней сводки — порог 21:00 по поясу клиента, выборка filled-записей
// за локальные сутки, дедуп делегируется в buildAndSendEveningSummary.

import { Op } from 'sequelize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nutrition-bot/ai', () => ({ buildAndSendEveningSummary: vi.fn() }));

vi.mock('@nutrition-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nutrition-bot/shared')>();
  return {
    ...actual,
    Client: { findAll: vi.fn() },
    NutritionDiary: { findAll: vi.fn() },
    notifyAdminJobFailuresDigest: vi.fn(),
  };
});

import { buildAndSendEveningSummary } from '@nutrition-bot/ai';
import { Client, NutritionDiary, notifyAdminJobFailuresDigest } from '@nutrition-bot/shared';
import {
  makeClient,
  makeDiaryEntry,
  makeEnrollment,
  makeNotificationSettings,
  makeTestLogger,
} from '@nutrition-bot/shared/testing';
import { runEveningSummaryJob } from './evening-summary-job.js';

// 21:00 Europe/Kaliningrad = 19:00 UTC.
const AT_SLOT = new Date('2026-01-15T19:00:00.000Z');
const BEFORE_SLOT = new Date('2026-01-15T18:30:00.000Z');
// 23:30 у клиента — слот 21:00 уже прошёл, сводка всё ещё уместна.
const LATE = new Date('2026-01-15T21:30:00.000Z');

function arrangeClient(id = 'client-1') {
  const client = makeClient({ id, telegramId: `tg-${id}` });
  return Object.assign(client, {
    notificationSettings: makeNotificationSettings({ clientId: id }),
    enrollments: [makeEnrollment({ clientId: id })],
  });
}

function arrange(clients = [arrangeClient()]) {
  vi.mocked(Client.findAll).mockResolvedValue(clients as never);
  vi.mocked(NutritionDiary.findAll).mockResolvedValue([makeDiaryEntry()] as never);
  vi.mocked(buildAndSendEveningSummary).mockResolvedValue({ sent: true, skipped: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(AT_SLOT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runEveningSummaryJob: слот 21:00', () => {
  it('отправляет сводку, когда локальные 21:00 наступили', async () => {
    arrange();

    const result = await runEveningSummaryJob(makeTestLogger());

    expect(result).toMatchObject({ job: 'evening-summary', considered: 1, sent: 1, skipped: 0 });
    expect(buildAndSendEveningSummary).toHaveBeenCalledOnce();
  });

  it('порог «не раньше», а не «ровно в 21:00»: поздний запуск тоже отправляет', async () => {
    vi.setSystemTime(LATE);
    arrange();

    await expect(runEveningSummaryJob(makeTestLogger())).resolves.toMatchObject({ sent: 1 });
  });

  it('молчит до 21:00 и не читает дневник', async () => {
    vi.setSystemTime(BEFORE_SLOT);
    arrange();

    const result = await runEveningSummaryJob(makeTestLogger());

    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    expect(NutritionDiary.findAll).not.toHaveBeenCalled();
    expect(buildAndSendEveningSummary).not.toHaveBeenCalled();
  });

  it('force отправляет до наступления слота', async () => {
    vi.setSystemTime(BEFORE_SLOT);
    arrange();

    const result = await runEveningSummaryJob(makeTestLogger(), { force: true });

    expect(result).toMatchObject({ force: true, sent: 1 });
    expect(vi.mocked(buildAndSendEveningSummary).mock.calls[0]?.[0]).toMatchObject({ force: true });
  });
});

describe('runEveningSummaryJob: данные для сводки', () => {
  it('берёт только filled-записи за локальные сутки клиента', async () => {
    arrange();

    await runEveningSummaryJob(makeTestLogger());

    const where = vi.mocked(NutritionDiary.findAll).mock.calls[0]?.[0]?.where as {
      clientEnrollmentId: string;
      status: string;
      mealAt: { [Op.between]: [Date, Date] };
    };
    expect(where).toMatchObject({ clientEnrollmentId: 'enrollment-1', status: 'filled' });
    const [start, end] = where.mealAt[Op.between];
    expect(start.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-15T21:59:59.999Z');
  });

  it('передаёт локальную дату клиента и его пояс', async () => {
    arrange();

    await runEveningSummaryJob(makeTestLogger());

    expect(vi.mocked(buildAndSendEveningSummary).mock.calls[0]?.[0]).toMatchObject({
      localDate: '2026-01-15',
      timezone: 'Europe/Kaliningrad',
      enrollmentId: 'enrollment-1',
    });
  });

  it('после локальной полуночи слот закрывается: сводка за прошедший день не уходит', async () => {
    // 22:30 UTC — уже 00:30 16 января у клиента. Локальные сутки перевернулись,
    // и порог 21:00 снова не выполнен: сводка за 15-е в этот запуск не уйдёт.
    vi.setSystemTime(new Date('2026-01-15T22:30:00.000Z'));
    arrange();

    const result = await runEveningSummaryJob(makeTestLogger());

    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    expect(buildAndSendEveningSummary).not.toHaveBeenCalled();
  });
});

describe('runEveningSummaryJob: дедуп и устойчивость', () => {
  it('отказ по дедупу считается пропуском, а не ошибкой', async () => {
    arrange();
    vi.mocked(buildAndSendEveningSummary).mockResolvedValue({
      sent: false,
      skipped: true,
      reason: 'already_sent',
    });

    const logger = makeTestLogger();
    const result = await runEveningSummaryJob(logger);

    expect(result).toMatchObject({ sent: 0, skipped: 1, errors: 0 });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('падение сводки одного клиента не мешает остальным и будит администратора', async () => {
    arrange([arrangeClient('client-1'), arrangeClient('client-2')]);
    vi.mocked(buildAndSendEveningSummary)
      .mockRejectedValueOnce(new Error('AI недоступен'))
      .mockResolvedValueOnce({ sent: true, skipped: false });

    const logger = makeTestLogger();
    const result = await runEveningSummaryJob(logger);

    expect(result).toMatchObject({ considered: 2, sent: 1, errors: 1 });
    expect(logger.error).toHaveBeenCalledOnce();
    const digestIssues = vi.mocked(notifyAdminJobFailuresDigest).mock.calls[0]?.[1];
    expect(digestIssues).toHaveLength(1);
    expect(digestIssues?.[0]?.clientId).toBe('client-1');
    expect(digestIssues?.[0]?.err).toBeInstanceOf(Error);
  });

  it('если AI упал, но ушла запасная сводка — администратор всё равно узнаёт', async () => {
    arrange();
    vi.mocked(buildAndSendEveningSummary).mockResolvedValue({
      sent: true,
      skipped: false,
      usedProviderFallback: true,
      providerError: new Error('insufficient_quota'),
    });

    const result = await runEveningSummaryJob(makeTestLogger());

    expect(result).toMatchObject({ sent: 1, errors: 0 });
    const fallbackIssues = vi.mocked(notifyAdminJobFailuresDigest).mock.calls[0]?.[1];
    expect(fallbackIssues).toHaveLength(1);
    expect(fallbackIssues?.[0]?.clientId).toBe('client-1');
    expect(fallbackIssues?.[0]?.usedFallback).toBe(true);
    expect(fallbackIssues?.[0]?.err).toBeInstanceOf(Error);
  });

  it('недоставка в Telegram считается ошибкой, но второй алерт не шлёт — его уже отправил sender', async () => {
    arrange();
    vi.mocked(buildAndSendEveningSummary).mockResolvedValue({
      sent: false,
      skipped: false,
      reason: 'delivery_failed',
    });

    const result = await runEveningSummaryJob(makeTestLogger());

    expect(result).toMatchObject({ sent: 0, errors: 1, skipped: 0 });
    expect(notifyAdminJobFailuresDigest).toHaveBeenCalledWith('evening_summary', []);
  });

  it('пропускает клиента без настроек или enrollment', async () => {
    vi.mocked(Client.findAll).mockResolvedValue([makeClient()] as never);

    const result = await runEveningSummaryJob(makeTestLogger());

    expect(result).toMatchObject({ considered: 1, sent: 0, skipped: 1 });
    expect(buildAndSendEveningSummary).not.toHaveBeenCalled();
  });
});
