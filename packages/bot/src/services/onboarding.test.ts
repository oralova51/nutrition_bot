// Unit-тесты онбординга: продление без повторной анкеты + синхронизация имени.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientEnrollment } from '@nutrition-bot/shared';
import type { BotContext } from '../context.js';
import { handleQuestionnaireAnswer, startOnboarding } from './onboarding.js';

vi.mock('@nutrition-bot/shared', () => ({
  Client: { findByPk: vi.fn() },
  Questionnaire: { findOne: vi.fn(), create: vi.fn() },
  QUESTIONNAIRE_QUESTIONS: [
    { id: 'name', text: 'Как к вам обращаться?', type: 'text' },
    { id: 'age', text: 'Сколько вам лет?', type: 'number', allowApproximate: true },
  ],
  TOTAL_QUESTIONNAIRE_QUESTIONS: 2,
  sendTelegramMessage: vi.fn(),
}));

vi.mock('../handlers/settings-handler.js', () => ({
  startSettingsWizard: vi.fn(),
}));

import { Client, Questionnaire, sendTelegramMessage } from '@nutrition-bot/shared';
import { startSettingsWizard } from '../handlers/settings-handler.js';

describe('startOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips questionnaire when onboardingStatus is completed (renewal)', async () => {
    const enrollment = {
      id: 'enrollment-2',
      clientId: 'client-1',
      onboardingStatus: 'completed',
      update: vi.fn(),
    } as unknown as ClientEnrollment;

    const ctx = {
      client: { id: 'client-1', telegramId: '123' },
      reply: vi.fn(),
    } as unknown as BotContext;

    await startOnboarding(ctx, enrollment);

    expect(Questionnaire.findOne).not.toHaveBeenCalled();
    expect(Questionnaire.create).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(startSettingsWizard).not.toHaveBeenCalled();
  });

  it('delegates to settings wizard when settings_pending', async () => {
    const enrollment = {
      id: 'enrollment-1',
      onboardingStatus: 'settings_pending',
      update: vi.fn(),
    } as unknown as ClientEnrollment;

    const ctx = { reply: vi.fn() } as unknown as BotContext;

    await startOnboarding(ctx, enrollment);

    expect(startSettingsWizard).toHaveBeenCalledWith(ctx);
    expect(Questionnaire.create).not.toHaveBeenCalled();
  });
});

describe('handleQuestionnaireAnswer — preferred name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates Client.firstName when answering «Как к вам обращаться?» (incl. re-onboarding)', async () => {
    const clientUpdate = vi.fn().mockResolvedValue(undefined);
    const questionnaireUpdate = vi.fn().mockResolvedValue(undefined);

    const enrollment = {
      id: 'enrollment-new',
      clientId: 'client-1',
      onboardingStatus: 'in_progress',
      update: vi.fn(),
    } as unknown as ClientEnrollment;

    const questionnaire = {
      id: 'q-1',
      clientEnrollmentId: enrollment.id,
      answers: {},
      currentQuestion: 0,
      status: 'in_progress',
      update: questionnaireUpdate,
    };

    vi.mocked(Questionnaire.findOne).mockResolvedValue(questionnaire as never);

    const ctx = {
      client: {
        id: 'client-1',
        firstName: 'пышкой',
        update: clientUpdate,
      },
      reply: vi.fn(),
    } as unknown as BotContext;

    await handleQuestionnaireAnswer(ctx, enrollment, 'Анна');

    expect(clientUpdate).toHaveBeenCalledWith({ firstName: 'Анна' });
    expect(questionnaireUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: { name: 'Анна' },
        currentQuestion: 1,
      }),
    );
    expect(Client.findByPk).not.toHaveBeenCalled();
  });

  it('loads Client by enrollment.clientId when ctx.client is missing', async () => {
    const clientUpdate = vi.fn().mockResolvedValue(undefined);
    const questionnaireUpdate = vi.fn().mockResolvedValue(undefined);

    const enrollment = {
      id: 'enrollment-new',
      clientId: 'client-1',
      onboardingStatus: 'in_progress',
      update: vi.fn(),
    } as unknown as ClientEnrollment;

    const questionnaire = {
      id: 'q-1',
      clientEnrollmentId: enrollment.id,
      answers: {},
      currentQuestion: 0,
      status: 'in_progress',
      update: questionnaireUpdate,
    };

    vi.mocked(Questionnaire.findOne).mockResolvedValue(questionnaire as never);
    vi.mocked(Client.findByPk).mockResolvedValue({
      id: 'client-1',
      firstName: 'пышкой',
      update: clientUpdate,
    } as never);

    const ctx = {
      reply: vi.fn(),
    } as unknown as BotContext;

    await handleQuestionnaireAnswer(ctx, enrollment, 'Марина');

    expect(Client.findByPk).toHaveBeenCalledWith('client-1');
    expect(clientUpdate).toHaveBeenCalledWith({ firstName: 'Марина' });
  });
});
