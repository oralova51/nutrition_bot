// Unit-тесты: при продлении (onboardingStatus=completed) анкету не запускаем повторно.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientEnrollment } from '@nutrition-bot/shared';
import type { BotContext } from '../context.js';
import { startOnboarding } from './onboarding.js';

vi.mock('@nutrition-bot/shared', () => ({
  Questionnaire: { findOne: vi.fn(), create: vi.fn() },
  QUESTIONNAIRE_QUESTIONS: [],
  TOTAL_QUESTIONNAIRE_QUESTIONS: 0,
  sendTelegramMessage: vi.fn(),
}));

vi.mock('../handlers/settings-handler.js', () => ({
  startSettingsWizard: vi.fn(),
}));

import { Questionnaire, sendTelegramMessage } from '@nutrition-bot/shared';
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
