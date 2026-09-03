import { describe, expect, it, vi } from 'vitest';
import { makeClient, makeEnrollment } from '@nutrition-bot/shared/testing';
import type { BotContext } from '../context.js';
import { photoMessageHandler } from './photo-handler.js';

const NO_COURSE_MESSAGE =
  'У вас пока нет активного курса. Обратитесь к администратору студии — он вышлет персональную ссылку-приглашение.';

const ONBOARDING_NOT_COMPLETED_MESSAGE =
  'Сначала завершите анкету и настройки уведомлений — после этого я смогу принимать записи о питании.';

const PHOTO_NOT_SUPPORTED_MESSAGE =
  'К сожалению, я пока не могу распознавать фотографии 😌. Пришли мне, пожалуйста, то, что ты съел текстом.';

function context(overrides: Partial<BotContext> = {}): BotContext {
  return {
    client: makeClient(),
    enrollment: makeEnrollment(),
    reply: vi.fn(),
    ...overrides,
  } as unknown as BotContext;
}

describe('photoMessageHandler', () => {
  it('просит приглашение, если курса нет', async () => {
    const ctx = context({ client: undefined, enrollment: undefined });
    await photoMessageHandler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(NO_COURSE_MESSAGE);
  });

  it('не принимает фото во время онбординга', async () => {
    const ctx = context({
      enrollment: makeEnrollment({ onboardingStatus: 'in_progress' }),
    });
    await photoMessageHandler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(ONBOARDING_NOT_COMPLETED_MESSAGE);
  });

  it('просит описать блюдо текстом, если онбординг завершён', async () => {
    const ctx = context();
    await photoMessageHandler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(PHOTO_NOT_SUPPORTED_MESSAGE);
  });
});
