// ФТ-8: вечернее напоминание в 20:00 по поясу клиента, только если за день
// меньше трёх записей дневника, и не больше одного раза в день.

import { Op } from 'sequelize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nutrition-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nutrition-bot/shared')>();
  return {
    ...actual,
    Client: { findAll: vi.fn() },
    Message: { count: vi.fn() },
    NutritionDiary: { count: vi.fn() },
    sendTelegramMessageWithRetry: vi.fn(),
  };
});

import {
  Client,
  Message,
  NutritionDiary,
  sendTelegramMessageWithRetry,
} from '@nutrition-bot/shared';
import {
  makeClient,
  makeEnrollment,
  makeNotificationSettings,
  makeTestLogger,
} from '@nutrition-bot/shared/testing';
import { runEveningReminderJob } from './evening-reminder-job.js';

// 20:00 Europe/Kaliningrad = 18:00 UTC.
const AT_SLOT = new Date('2026-01-15T18:00:00.000Z');
const BEFORE_SLOT = new Date('2026-01-15T17:30:00.000Z');
// 20:00 UTC — уже 22:00 у клиента, слот пропущен.
const UTC_SLOT = new Date('2026-01-15T20:00:00.000Z');

function arrangeClient() {
  const client = makeClient();
  return Object.assign(client, {
    notificationSettings: makeNotificationSettings({ clientId: client.id }),
    enrollments: [makeEnrollment({ clientId: client.id })],
  });
}

interface ArrangeOptions {
  diaryCount?: number;
  reminderAlreadySent?: boolean;
}

function arrange(options: ArrangeOptions = {}) {
  vi.mocked(Client.findAll).mockResolvedValue([arrangeClient()] as never);
  vi.mocked(NutritionDiary.count).mockResolvedValue(options.diaryCount ?? 0);
  vi.mocked(Message.count).mockResolvedValue(options.reminderAlreadySent ? 1 : 0);
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

describe('runEveningReminderJob: слот 20:00', () => {
  it('отправляет напоминание в 20:00 по поясу клиента', async () => {
    arrange();

    const result = await runEveningReminderJob(makeTestLogger());

    expect(result).toMatchObject({ job: 'evening-reminder', considered: 1, sent: 1, skipped: 0 });
    expect(vi.mocked(sendTelegramMessageWithRetry).mock.calls[0]?.[0]).toMatchObject({
      type: 'evening_reminder',
      category: 'optional',
    });
  });

  it('молчит до наступления слота', async () => {
    vi.setSystemTime(BEFORE_SLOT);
    arrange();

    const result = await runEveningReminderJob(makeTestLogger());

    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    // До проверки времени запросов к дневнику быть не должно.
    expect(NutritionDiary.count).not.toHaveBeenCalled();
  });

  it('не путает 20:00 UTC с 20:00 у клиента', async () => {
    vi.setSystemTime(UTC_SLOT);
    arrange();

    await expect(runEveningReminderJob(makeTestLogger())).resolves.toMatchObject({ sent: 0 });
  });
});

describe('runEveningReminderJob: условия отправки', () => {
  it('молчит, если за день уже три записи', async () => {
    arrange({ diaryCount: 3 });

    const result = await runEveningReminderJob(makeTestLogger());

    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    expect(Message.count).not.toHaveBeenCalled();
  });

  it('отправляет при двух записях за день', async () => {
    arrange({ diaryCount: 2 });

    await expect(runEveningReminderJob(makeTestLogger())).resolves.toMatchObject({ sent: 1 });
  });

  it('не отправляет второе напоминание за тот же день', async () => {
    arrange({ reminderAlreadySent: true });

    const result = await runEveningReminderJob(makeTestLogger());

    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
  });

  it('повторный запуск в том же слоте идемпотентен: второй раз видит своё же сообщение', async () => {
    arrange();
    await expect(runEveningReminderJob(makeTestLogger())).resolves.toMatchObject({ sent: 1 });

    vi.mocked(Message.count).mockResolvedValue(1);
    await expect(runEveningReminderJob(makeTestLogger())).resolves.toMatchObject({ sent: 0 });

    expect(sendTelegramMessageWithRetry).toHaveBeenCalledOnce();
  });

  it('считает записи и сообщения за локальные сутки клиента, а не за UTC-сутки', async () => {
    arrange();

    await runEveningReminderJob(makeTestLogger());

    // Сутки 2026-01-15 в Europe/Kaliningrad (UTC+2) начинаются 14-го в 22:00 UTC.
    const diaryWhere = vi.mocked(NutritionDiary.count).mock.calls[0]?.[0]?.where as {
      mealAt: { [Op.between]: [Date, Date] };
    };
    const [diaryStart, diaryEnd] = diaryWhere.mealAt[Op.between];
    expect(diaryStart.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    expect(diaryEnd.toISOString()).toBe('2026-01-15T21:59:59.999Z');

    const messageWhere = vi.mocked(Message.count).mock.calls[0]?.[0]?.where as {
      createdAt: { [Op.between]: [Date, Date] };
    };
    expect(messageWhere.createdAt[Op.between]).toEqual([diaryStart, diaryEnd]);
  });
});

describe('runEveningReminderJob: force и устойчивость', () => {
  it('force обходит слот, лимит записей и дневной дедуп', async () => {
    vi.setSystemTime(BEFORE_SLOT);
    arrange({ diaryCount: 5, reminderAlreadySent: true });

    const result = await runEveningReminderJob(makeTestLogger(), { force: true });

    expect(result).toMatchObject({ force: true, sent: 1 });
    expect(NutritionDiary.count).not.toHaveBeenCalled();
    expect(Message.count).not.toHaveBeenCalled();
  });

  it('сбой доставки попадает в errors, а не рушит job', async () => {
    arrange();
    vi.mocked(sendTelegramMessageWithRetry).mockRejectedValue(new Error('Telegram недоступен'));

    const logger = makeTestLogger();
    const result = await runEveningReminderJob(logger);

    expect(result).toMatchObject({ sent: 0, errors: 1 });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
