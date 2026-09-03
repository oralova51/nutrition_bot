// Тесты вечерней сводки (ФТ-24, roadmap 13.4): сводка уходит один раз за локальные
// сутки, не раньше 21:00 и только при включённых уведомлениях. Хелперы времени взяты
// настоящие — именно они решают, наступил ли слот и какие сутки считать текущими.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Op } from 'sequelize';
import {
  makeClient,
  makeDiaryEntry,
  makeMessage,
  makeNotificationSettings,
  makeReport,
} from '@nutrition-bot/shared/testing';

vi.mock('@nutrition-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nutrition-bot/shared')>();
  return {
    ...actual,
    Message: { count: vi.fn() },
    NotificationSettings: { findOne: vi.fn() },
    NutritionDiary: { findAll: vi.fn() },
    Report: { findOne: vi.fn(), create: vi.fn() },
    sendTelegramMessageWithRetry: vi.fn(),
    notifyAdminJobFailure: vi.fn(),
  };
});
vi.mock('./factory.js', () => ({ createAIEngine: vi.fn() }));
vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  Message,
  NotificationSettings,
  NutritionDiary,
  Report,
  sendTelegramMessageWithRetry,
} from '@nutrition-bot/shared';
import { buildAndSendEveningSummary, maybeSendEveningSummaryIfDue } from './evening-summary.js';
import { createAIEngine } from './factory.js';
import type { AIEngine } from './types.js';

const SUMMARY_TEXT = 'Сегодня получилось три приёма пищи — хороший день!';
/** 15 января 2026, 21:30 по Europe/Kaliningrad. */
const AFTER_SLOT = new Date('2026-01-15T19:30:00.000Z');
/** 15 января 2026, 20:59 по Europe/Kaliningrad — слот ещё не наступил. */
const BEFORE_SLOT = new Date('2026-01-15T18:59:00.000Z');
const LOCAL_DAY_START = new Date('2026-01-14T22:00:00.000Z');
const LOCAL_DAY_END = new Date('2026-01-15T21:59:59.999Z');

function fakeEngine(): AIEngine {
  return {
    analyzeDiary: vi.fn(),
    generateRecommendationText: vi.fn(),
    generateEveningSummary: vi.fn().mockResolvedValue({
      enough: ['белок'],
      missing: ['овощи'],
      toAdd: ['салат'],
      improvements: [],
      summaryText: SUMMARY_TEXT,
      metadata: { engine: 'fake' },
    }),
    checkDiaryClarity: vi.fn(),
    extractTopProducts: vi.fn(),
  };
}

interface ArrangeOptions {
  alreadySentToday?: boolean;
  dayEntries?: ReturnType<typeof makeDiaryEntry>[];
  settings?: ReturnType<typeof makeNotificationSettings> | null;
  existingReport?: ReturnType<typeof makeReport> | null;
}

function arrange(options: ArrangeOptions = {}) {
  const client = makeClient();
  const entries = options.dayEntries ?? [makeDiaryEntry({ approxCalories: 400 })];
  const report = makeReport({ type: 'daily' });
  const engine = fakeEngine();

  vi.mocked(NotificationSettings.findOne).mockResolvedValue(
    options.settings === undefined ? makeNotificationSettings() : options.settings,
  );
  vi.mocked(NutritionDiary.findAll).mockResolvedValue(entries);
  vi.mocked(Message.count).mockResolvedValue(options.alreadySentToday ? 1 : 0);
  vi.mocked(Report.findOne).mockResolvedValue(options.existingReport ?? null);
  vi.mocked(Report.create).mockResolvedValue(report);
  vi.mocked(sendTelegramMessageWithRetry).mockResolvedValue({
    telegramMessageId: 555,
    message: makeMessage({ type: 'evening_summary' }),
  });
  vi.mocked(createAIEngine).mockReturnValue(engine);

  return { client, entries, report, engine };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(AFTER_SLOT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('maybeSendEveningSummaryIfDue — условия отправки', () => {
  it('молчит до 21:00 по локальному времени и не читает настройки', async () => {
    const { client } = arrange();
    vi.setSystemTime(BEFORE_SLOT);

    const result = await maybeSendEveningSummaryIfDue({ client, enrollmentId: 'enrollment-1' });

    expect(result).toEqual({ sent: false, skipped: true, reason: 'too_early' });
    expect(NotificationSettings.findOne).not.toHaveBeenCalled();
  });

  it('не отправляет клиенту без telegramId', async () => {
    arrange();

    const result = await maybeSendEveningSummaryIfDue({
      client: makeClient({ telegramId: null }),
      enrollmentId: 'enrollment-1',
    });

    expect(result).toEqual({ sent: false, skipped: true, reason: 'no_telegram' });
  });

  it('не отправляет при выключенных уведомлениях', async () => {
    const { client } = arrange({ settings: makeNotificationSettings({ enabled: false }) });

    const result = await maybeSendEveningSummaryIfDue({ client, enrollmentId: 'enrollment-1' });

    expect(result).toEqual({ sent: false, skipped: true, reason: 'notifications_disabled' });
    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
  });

  it('не отправляет, если клиент отключил именно вечернюю сводку', async () => {
    const { client } = arrange({
      settings: makeNotificationSettings({ enabledTypes: ['diary', 'recommendations'] }),
    });

    const result = await maybeSendEveningSummaryIfDue({ client, enrollmentId: 'enrollment-1' });

    expect(result).toEqual({ sent: false, skipped: true, reason: 'notifications_disabled' });
  });

  it('не отправляет пустую сводку, если за день нет заполненных записей', async () => {
    const { client } = arrange({ dayEntries: [] });

    const result = await maybeSendEveningSummaryIfDue({ client, enrollmentId: 'enrollment-1' });

    expect(result).toEqual({ sent: false, skipped: true, reason: 'no_filled_entries' });
    expect(Report.create).not.toHaveBeenCalled();
  });

  it('берёт записи дня по локальным суткам клиента', async () => {
    const { client } = arrange();

    await maybeSendEveningSummaryIfDue({ client, enrollmentId: 'enrollment-1' });

    expect(NutritionDiary.findAll).toHaveBeenCalledWith({
      where: {
        clientEnrollmentId: 'enrollment-1',
        status: 'filled',
        mealAt: { [Op.between]: [LOCAL_DAY_START, LOCAL_DAY_END] },
      },
      order: [['mealAt', 'ASC']],
    });
  });
});

describe('maybeSendEveningSummaryIfDue — сводка не уходит дважды', () => {
  it('пропускает день, если сводка уже отправлена', async () => {
    const { client, engine } = arrange({ alreadySentToday: true });

    const result = await maybeSendEveningSummaryIfDue({ client, enrollmentId: 'enrollment-1' });

    expect(result).toEqual({ sent: false, skipped: true, reason: 'already_sent' });
    expect(engine.generateEveningSummary).not.toHaveBeenCalled();
    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
    expect(Report.create).not.toHaveBeenCalled();
  });

  it('ищет уже отправленную сводку в пределах локальных суток', async () => {
    const { client } = arrange();

    await maybeSendEveningSummaryIfDue({ client, enrollmentId: 'enrollment-1' });

    expect(Message.count).toHaveBeenCalledWith({
      where: {
        clientId: 'client-1',
        type: 'evening_summary',
        deliveryStatus: { [Op.in]: ['sent', 'delivered', 'read'] },
        createdAt: { [Op.between]: [LOCAL_DAY_START, LOCAL_DAY_END] },
      },
    });
  });

  it('отправляет сводку и заводит дневной отчёт', async () => {
    const { client, report } = arrange();

    const result = await maybeSendEveningSummaryIfDue({ client, enrollmentId: 'enrollment-1' });

    expect(Report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientEnrollmentId: 'enrollment-1',
        clientId: 'client-1',
        type: 'daily',
        periodStart: '2026-01-15',
        periodEnd: '2026-01-15',
        aiSummary: SUMMARY_TEXT,
      }),
    );
    expect(sendTelegramMessageWithRetry).toHaveBeenCalledWith({
      telegramId: '100200300',
      text: SUMMARY_TEXT,
      clientId: 'client-1',
      type: 'evening_summary',
      category: 'optional',
    });
    expect(result).toEqual({ sent: true, skipped: false, reportId: report.id });
  });

  it('санитизирует HTML нейронки, иначе Telegram отвергает сводку', async () => {
    const { client, engine } = arrange();
    vi.mocked(engine.generateEveningSummary).mockResolvedValue({
      enough: ['белок'],
      missing: ['овощи'],
      toAdd: ['салат'],
      improvements: [],
      summaryText: '<b>Сводка</b><br>белка < 20 г',
      metadata: { engine: 'fake' },
    });

    await maybeSendEveningSummaryIfDue({ client, enrollmentId: 'enrollment-1' });

    expect(sendTelegramMessageWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '<b>Сводка</b>\nбелка &lt; 20 г',
        type: 'evening_summary',
      }),
    );
  });
});

describe('buildAndSendEveningSummary — повторная отправка вручную', () => {
  const dayRange = { start: LOCAL_DAY_START, end: LOCAL_DAY_END };

  it('с force отправляет повторно, не проверяя историю сообщений', async () => {
    const { client, entries } = arrange({ alreadySentToday: true });

    const result = await buildAndSendEveningSummary({
      client,
      enrollmentId: 'enrollment-1',
      dayEntries: entries,
      localDate: '2026-01-15',
      timezone: 'Europe/Kaliningrad',
      dayRange,
      force: true,
    });

    expect(Message.count).not.toHaveBeenCalled();
    expect(result.sent).toBe(true);
  });

  it('не отправляет клиенту без telegramId даже с force', async () => {
    const { entries } = arrange();

    const result = await buildAndSendEveningSummary({
      client: makeClient({ telegramId: null }),
      enrollmentId: 'enrollment-1',
      dayEntries: entries,
      localDate: '2026-01-15',
      timezone: 'Europe/Kaliningrad',
      dayRange,
      force: true,
    });

    expect(result).toEqual({ sent: false, skipped: true, reason: 'no_telegram' });
    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
  });

  it('обновляет существующий дневной отчёт вместо второй строки', async () => {
    const existingReport = makeReport({ id: 'report-daily', type: 'daily' });
    const { client, entries } = arrange({ existingReport });

    const result = await buildAndSendEveningSummary({
      client,
      enrollmentId: 'enrollment-1',
      dayEntries: entries,
      localDate: '2026-01-15',
      timezone: 'Europe/Kaliningrad',
      dayRange,
      force: true,
    });

    expect(Report.create).not.toHaveBeenCalled();
    expect(existingReport.update).toHaveBeenCalledWith(
      expect.objectContaining({ periodEnd: '2026-01-15', aiSummary: SUMMARY_TEXT }),
    );
    expect(result.reportId).toBe('report-daily');
  });

  it('помечает запасную сводку, если AI вернул provider_error', async () => {
    const { client, entries, engine } = arrange();
    vi.mocked(engine.generateEveningSummary).mockResolvedValue({
      enough: [],
      missing: [],
      toAdd: [],
      improvements: [],
      summaryText: SUMMARY_TEXT,
      metadata: { reason: 'provider_error', providerError: new Error('insufficient_quota') },
    });

    const result = await buildAndSendEveningSummary({
      client,
      enrollmentId: 'enrollment-1',
      dayEntries: entries,
      localDate: '2026-01-15',
      timezone: 'Europe/Kaliningrad',
      dayRange,
      force: true,
    });

    expect(result).toMatchObject({
      sent: true,
      usedProviderFallback: true,
    });
    expect(result.providerError).toBeInstanceOf(Error);
  });

  it('не бросает, если Telegram не принял уже собранную сводку', async () => {
    const { client, entries } = arrange();
    vi.mocked(sendTelegramMessageWithRetry).mockRejectedValue(new Error('bot was blocked'));

    const result = await buildAndSendEveningSummary({
      client,
      enrollmentId: 'enrollment-1',
      dayEntries: entries,
      localDate: '2026-01-15',
      timezone: 'Europe/Kaliningrad',
      dayRange,
      force: true,
    });

    expect(result).toMatchObject({ sent: false, reason: 'delivery_failed' });
    expect(Report.create).toHaveBeenCalled();
  });
});
