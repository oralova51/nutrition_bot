// Roadmap 3.14: напоминание о брошенной анкете — порог молчания и одно
// напоминание до следующего ответа.

import { Op } from 'sequelize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nutrition-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nutrition-bot/shared')>();
  return {
    ...actual,
    Questionnaire: { findAll: vi.fn() },
    ClientEnrollment: {
      ...actual.ClientEnrollment,
      findOne: vi.fn().mockResolvedValue(null),
    },
    sendTelegramMessageWithRetry: vi.fn(),
  };
});

import {
  ClientEnrollment,
  Questionnaire,
  sendTelegramMessageWithRetry,
} from '@nutrition-bot/shared';
import {
  makeClient,
  makeEnrollment,
  makeQuestionnaire,
  makeTestLogger,
} from '@nutrition-bot/shared/testing';
import { runQuestionnaireReminderJob } from './questionnaire-reminder.js';

const NOW = new Date('2026-01-15T09:00:00.000Z');

function arrangeQuestionnaire(overrides: Parameters<typeof makeQuestionnaire>[0] = {}) {
  const questionnaire = makeQuestionnaire(overrides);
  return Object.assign(questionnaire, {
    client: makeClient(),
    enrollment: makeEnrollment({ onboardingStatus: 'in_progress' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(sendTelegramMessageWithRetry).mockResolvedValue({ telegramMessageId: 1 } as never);
  vi.mocked(ClientEnrollment.findOne).mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runQuestionnaireReminderJob', () => {
  it('напоминает номер вопроса, на котором клиент остановился', async () => {
    vi.mocked(Questionnaire.findAll).mockResolvedValue([
      arrangeQuestionnaire({ currentQuestion: 3 }),
    ] as never);

    await runQuestionnaireReminderJob(makeTestLogger());

    expect(vi.mocked(sendTelegramMessageWithRetry).mock.calls[0]?.[0]).toMatchObject({
      type: 'questionnaire_reminder',
      category: 'optional',
    });
    // currentQuestion — индекс с нуля, клиенту показываем номер.
    expect(vi.mocked(sendTelegramMessageWithRetry).mock.calls[0]?.[0]?.text).toContain('вопросе 4');
  });

  it('берёт анкеты, где ответа и напоминания не было дольше порога', async () => {
    vi.mocked(Questionnaire.findAll).mockResolvedValue([]);

    await runQuestionnaireReminderJob(makeTestLogger(), { inactivityMinutes: 1440 });

    const where = vi.mocked(Questionnaire.findAll).mock.calls[0]?.[0]?.where as {
      status: string;
      [Op.and]: Array<{
        [Op.or]: Array<
          | { lastAnswerAt: null }
          | { lastAnswerAt: { [Op.lt]: Date } }
          | { lastReminderAt: null }
          | { lastReminderAt: { [Op.lt]: Date } }
        >;
      }>;
    };
    expect(where.status).toBe('in_progress');
    const lastAnswer = where[Op.and][0]?.[Op.or][1] as { lastAnswerAt: { [Op.lt]: Date } };
    const lastReminder = where[Op.and][1]?.[Op.or][1] as { lastReminderAt: { [Op.lt]: Date } };
    expect(lastAnswer.lastAnswerAt[Op.lt].toISOString()).toBe('2026-01-14T09:00:00.000Z');
    expect(lastReminder.lastReminderAt[Op.lt].toISOString()).toBe('2026-01-14T09:00:00.000Z');
  });

  it('принимает порог молчания из аргумента job (для отладки)', async () => {
    vi.mocked(Questionnaire.findAll).mockResolvedValue([]);

    await runQuestionnaireReminderJob(makeTestLogger(), { inactivityMinutes: 2 });

    const where = vi.mocked(Questionnaire.findAll).mock.calls[0]?.[0]?.where as {
      [Op.and]: Array<{
        [Op.or]: Array<{ lastAnswerAt: { [Op.lt]: Date } } | { lastAnswerAt: null }>;
      }>;
    };
    const lastAnswer = where[Op.and][0]?.[Op.or][1] as { lastAnswerAt: { [Op.lt]: Date } };
    expect(lastAnswer.lastAnswerAt[Op.lt].toISOString()).toBe('2026-01-15T08:58:00.000Z');
  });

  it('фиксирует lastReminderAt, чтобы не напомнить дважды до следующего ответа', async () => {
    const questionnaire = arrangeQuestionnaire();
    vi.mocked(Questionnaire.findAll).mockResolvedValue([questionnaire] as never);

    await runQuestionnaireReminderJob(makeTestLogger());

    expect(questionnaire.update).toHaveBeenCalledWith({ lastReminderAt: NOW });
    expect(questionnaire.lastReminderAt).toEqual(NOW);
  });

  it('фиксирует lastReminderAt даже если отправка не удалась, чтобы не долбить тот же чат', async () => {
    const questionnaire = arrangeQuestionnaire();
    vi.mocked(Questionnaire.findAll).mockResolvedValue([questionnaire] as never);
    vi.mocked(sendTelegramMessageWithRetry).mockRejectedValue(new Error('chat not found'));

    const logger = makeTestLogger();
    await runQuestionnaireReminderJob(logger);

    expect(questionnaire.update).toHaveBeenCalledWith({ lastReminderAt: NOW });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('пропускает анкету без клиента с telegramId', async () => {
    const questionnaire = makeQuestionnaire();
    vi.mocked(Questionnaire.findAll).mockResolvedValue([questionnaire] as never);

    await runQuestionnaireReminderJob(makeTestLogger());

    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
  });

  it('не напоминает, если у клиента уже есть пройденный онбординг на другом курсе', async () => {
    const questionnaire = arrangeQuestionnaire();
    vi.mocked(Questionnaire.findAll).mockResolvedValue([questionnaire] as never);
    vi.mocked(ClientEnrollment.findOne).mockResolvedValue(makeEnrollment() as never);

    await runQuestionnaireReminderJob(makeTestLogger());

    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
    expect(questionnaire.update).not.toHaveBeenCalled();
  });
});
