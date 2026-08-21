// ФТ-4: ежедневное напоминание уходит в слот reminderTime по поясу клиента
// и только в те дни, которые разрешает выбранная частота.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nutrition-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nutrition-bot/shared')>();
  return {
    ...actual,
    Client: { findAll: vi.fn() },
    sendTelegramMessageWithRetry: vi.fn(),
  };
});

import { Client, sendTelegramMessageWithRetry } from '@nutrition-bot/shared';
import {
  makeClient,
  makeEnrollment,
  makeNotificationSettings,
  makeTestLogger,
} from '@nutrition-bot/shared/testing';
import { runDailyReminderJob } from './daily-reminder.js';

// 2026-01-15 11:00 Europe/Kaliningrad — четверг (ISO 4), не день three_per_week.
const AT_SLOT = new Date('2026-01-15T09:00:00.000Z');
// Тот же день, 11:30 — слот 11:00 уже прошёл.
const OFF_SLOT = new Date('2026-01-15T09:30:00.000Z');
// 2026-01-16 11:00 Europe/Kaliningrad — пятница (ISO 5), день three_per_week.
const AT_SLOT_FRIDAY = new Date('2026-01-16T09:00:00.000Z');

const SLOT_TIME = '11:00';

type ClientOverrides = Parameters<typeof makeClient>[0];
type SettingsOverrides = Parameters<typeof makeNotificationSettings>[0];
type EnrollmentOverrides = Parameters<typeof makeEnrollment>[0];

function arrangeClient(
  overrides: {
    client?: ClientOverrides;
    settings?: SettingsOverrides;
    enrollment?: EnrollmentOverrides;
  } = {},
) {
  const client = makeClient(overrides.client);
  return Object.assign(client, {
    notificationSettings: makeNotificationSettings({
      clientId: client.id,
      reminderTime: SLOT_TIME,
      ...overrides.settings,
    }),
    enrollments: [makeEnrollment({ clientId: client.id, ...overrides.enrollment })],
  });
}

function arrangeFindAll(...clients: ReturnType<typeof arrangeClient>[]): void {
  vi.mocked(Client.findAll).mockResolvedValue(clients as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(AT_SLOT);
  vi.mocked(sendTelegramMessageWithRetry).mockResolvedValue({
    telegramMessageId: 1,
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('runDailyReminderJob: слот отправки', () => {
  it('отправляет напоминание, когда локальное время совпало с reminderTime', async () => {
    arrangeFindAll(arrangeClient());

    const result = await runDailyReminderJob(makeTestLogger());

    expect(result).toMatchObject({ job: 'daily-reminder', considered: 1, sent: 1, skipped: 0 });
    expect(sendTelegramMessageWithRetry).toHaveBeenCalledOnce();
    expect(vi.mocked(sendTelegramMessageWithRetry).mock.calls[0]?.[0]).toMatchObject({
      telegramId: '100200300',
      clientId: 'client-1',
      type: 'reminder',
      category: 'optional',
    });
  });

  it('пропускает клиента вне его слота', async () => {
    vi.setSystemTime(OFF_SLOT);
    arrangeFindAll(arrangeClient());

    const result = await runDailyReminderJob(makeTestLogger());

    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
  });

  it('сравнивает слот с локальным временем клиента, а не с UTC', async () => {
    // 09:00 UTC — это 11:00 в Europe/Kaliningrad. Клиент с reminderTime 09:00
    // не должен получить напоминание в этот момент.
    arrangeFindAll(arrangeClient({ settings: { reminderTime: '09:00' } }));

    const result = await runDailyReminderJob(makeTestLogger());

    expect(result).toMatchObject({ sent: 0, skipped: 1 });
  });

  it('пропускает клиента без настроек или enrollment', async () => {
    const client = makeClient();
    arrangeFindAll(client as never);

    const result = await runDailyReminderJob(makeTestLogger());

    expect(result).toMatchObject({ considered: 1, sent: 0, skipped: 1 });
  });
});

describe('runDailyReminderJob: частота', () => {
  it('daily отправляет каждый день', async () => {
    arrangeFindAll(arrangeClient({ settings: { frequency: 'daily' } }));

    await expect(runDailyReminderJob(makeTestLogger())).resolves.toMatchObject({ sent: 1 });
  });

  it('every_other_day отправляет на чётный день от startDate', async () => {
    // 2026-01-01 → 2026-01-15: 14 дней, чётный шаг.
    arrangeFindAll(
      arrangeClient({
        settings: { frequency: 'every_other_day' },
        enrollment: { startDate: '2026-01-01' },
      }),
    );

    await expect(runDailyReminderJob(makeTestLogger())).resolves.toMatchObject({ sent: 1 });
  });

  it('every_other_day молчит на нечётный день от startDate', async () => {
    // 2026-01-02 → 2026-01-15: 13 дней.
    arrangeFindAll(
      arrangeClient({
        settings: { frequency: 'every_other_day' },
        enrollment: { startDate: '2026-01-02' },
      }),
    );

    await expect(runDailyReminderJob(makeTestLogger())).resolves.toMatchObject({
      sent: 0,
      skipped: 1,
    });
  });

  it('every_other_day молчит, если курс ещё не начался', async () => {
    // startDate в будущем: разница -2 дня даёт чётный остаток, но отправлять нечего.
    arrangeFindAll(
      arrangeClient({
        settings: { frequency: 'every_other_day' },
        enrollment: { startDate: '2026-01-17' },
      }),
    );

    await expect(runDailyReminderJob(makeTestLogger())).resolves.toMatchObject({
      sent: 0,
      skipped: 1,
    });
  });

  it('three_per_week отправляет в пятницу и молчит в четверг', async () => {
    arrangeFindAll(arrangeClient({ settings: { frequency: 'three_per_week' } }));
    await expect(runDailyReminderJob(makeTestLogger())).resolves.toMatchObject({ sent: 0 });

    vi.setSystemTime(AT_SLOT_FRIDAY);
    arrangeFindAll(arrangeClient({ settings: { frequency: 'three_per_week' } }));
    await expect(runDailyReminderJob(makeTestLogger())).resolves.toMatchObject({ sent: 1 });
  });

  it('custom_days не отправляет: вариант отложен до post-MVP', async () => {
    arrangeFindAll(arrangeClient({ settings: { frequency: 'custom_days' } }));

    await expect(runDailyReminderJob(makeTestLogger())).resolves.toMatchObject({
      sent: 0,
      skipped: 1,
    });
  });

  it('не зависит от системного пояса процесса', async () => {
    // Слот и паритет every_other_day считаются по поясу клиента. Если считать их
    // через системный пояс, на сервере восточнее UTC календарный день уезжает
    // и «через день» попадает ровно в противоположные дни.
    for (const systemTimezone of ['UTC', 'Europe/Moscow', 'Asia/Tokyo', 'America/New_York']) {
      vi.stubEnv('TZ', systemTimezone);
      vi.setSystemTime(AT_SLOT);
      arrangeFindAll(
        arrangeClient({
          settings: { frequency: 'every_other_day' },
          enrollment: { startDate: '2026-01-01' },
        }),
      );

      const result = await runDailyReminderJob(makeTestLogger());

      expect(result, `системный пояс ${systemTimezone}`).toMatchObject({ sent: 1, skipped: 0 });
    }
  });
});

describe('runDailyReminderJob: force и выборка', () => {
  it('force игнорирует и слот, и частоту', async () => {
    vi.setSystemTime(OFF_SLOT);
    arrangeFindAll(arrangeClient({ settings: { frequency: 'custom_days' } }));

    const result = await runDailyReminderJob(makeTestLogger(), { force: true });

    expect(result).toMatchObject({ force: true, sent: 1, skipped: 0 });
  });

  it('clientId сужает выборку до одного клиента', async () => {
    arrangeFindAll(arrangeClient());

    await runDailyReminderJob(makeTestLogger(), { clientId: 'client-42' });

    expect(vi.mocked(Client.findAll).mock.calls[0]?.[0]?.where).toMatchObject({ id: 'client-42' });
  });

  it('сбой доставки одному клиенту не мешает остальным', async () => {
    arrangeFindAll(
      arrangeClient({ client: { id: 'client-1', telegramId: '111' } }),
      arrangeClient({ client: { id: 'client-2', telegramId: '222' } }),
    );
    vi.mocked(sendTelegramMessageWithRetry)
      .mockRejectedValueOnce(new Error('Telegram недоступен'))
      .mockResolvedValueOnce({ telegramMessageId: 2 } as never);

    const logger = makeTestLogger();
    const result = await runDailyReminderJob(logger);

    expect(result).toMatchObject({ considered: 2, sent: 1, errors: 1 });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
