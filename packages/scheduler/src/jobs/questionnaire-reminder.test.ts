// Roadmap 3.14: напоминание о брошенной анкете — порог молчания и одно
// напоминание до следующего ответа.

import { Op } from 'sequelize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nutrition-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nutrition-bot/shared')>();
  return {
    ...actual,
    Questionnaire: { findAll: vi.fn() },
    sendTelegramMessageWithRetry: vi.fn(),
  };
});

import { Questionnaire, sendTelegramMessageWithRetry } from '@nutrition-bot/shared';
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

  it('берёт анкеты, где ответа не было дольше порога и напоминание ещё не уходило', async () => {
    vi.mocked(Questionnaire.findAll).mockResolvedValue([]);

    await runQuestionnaireReminderJob(makeTestLogger());

    const where = vi.mocked(Questionnaire.findAll).mock.calls[0]?.[0]?.where as {
      status: string;
      lastReminderAt: null;
      [Op.or]: [{ lastAnswerAt: null }, { lastAnswerAt: { [Op.lt]: Date } }];
    };
    expect(where.status).toBe('in_progress');
    expect(where.lastReminderAt).toBeNull();
    expect(where[Op.or][1].lastAnswerAt[Op.lt].toISOString()).toBe('2026-01-15T08:58:00.000Z');
  });

  it('фиксирует lastReminderAt, чтобы не напомнить дважды до следующего ответа', async () => {
    const questionnaire = arrangeQuestionnaire();
    vi.mocked(Questionnaire.findAll).mockResolvedValue([questionnaire] as never);

    await runQuestionnaireReminderJob(makeTestLogger());

    expect(questionnaire.update).toHaveBeenCalledWith({ lastReminderAt: NOW });
    expect(questionnaire.lastReminderAt).toEqual(NOW);
  });

  it('не помечает анкету напомненной, если отправка не удалась', async () => {
    const questionnaire = arrangeQuestionnaire();
    vi.mocked(Questionnaire.findAll).mockResolvedValue([questionnaire] as never);
    vi.mocked(sendTelegramMessageWithRetry).mockRejectedValue(new Error('Telegram недоступен'));

    const logger = makeTestLogger();
    await runQuestionnaireReminderJob(logger);

    expect(questionnaire.update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('пропускает анкету без клиента с telegramId', async () => {
    const questionnaire = makeQuestionnaire();
    vi.mocked(Questionnaire.findAll).mockResolvedValue([questionnaire] as never);

    await runQuestionnaireReminderJob(makeTestLogger());

    expect(sendTelegramMessageWithRetry).not.toHaveBeenCalled();
  });
});
