// Roadmap 13.4: анализ AI не должен влиять на подтверждение записи дневника.
// Запись сохраняется и подтверждается синхронно, а processDiaryEntry запускается
// фоном — падение или зависание модели клиент видеть не должен.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeClient,
  makeDiaryEntry,
  makeEnrollment,
  makeMessage,
} from '@nutrition-bot/shared/testing';

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@nutrition-bot/ai', () => ({ processDiaryEntry: vi.fn() }));
vi.mock('@nutrition-bot/shared', () => ({
  createLogger: () => logger,
  DEFAULT_TIMEZONE: 'Europe/Kaliningrad',
  NutritionDiary: { create: vi.fn(), findOne: vi.fn() },
  sendTelegramMessage: vi.fn(),
}));

import { processDiaryEntry } from '@nutrition-bot/ai';
import { NutritionDiary, sendTelegramMessage } from '@nutrition-bot/shared';
import type { BotContext } from '../context.js';
import { handleNutritionDiaryEntry } from './nutrition-diary.js';

const CONFIRMATION_MESSAGE = 'Спасибо, записал! 🍽️';

function context(): BotContext {
  return {
    client: makeClient(),
    enrollment: makeEnrollment(),
    reply: vi.fn(),
  } as unknown as BotContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(NutritionDiary.findOne).mockResolvedValue(null);
  vi.mocked(NutritionDiary.create).mockResolvedValue(makeDiaryEntry());
  vi.mocked(sendTelegramMessage).mockResolvedValue({
    telegramMessageId: 1,
    message: makeMessage(),
  });
});

describe('handleNutritionDiaryEntry — изоляция ошибок AI', () => {
  it('подтверждает запись, даже если анализ упал', async () => {
    vi.mocked(processDiaryEntry).mockRejectedValue(new Error('AI недоступен'));

    await handleNutritionDiaryEntry(context(), 'Обед: суп и салат');

    expect(NutritionDiary.create).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: CONFIRMATION_MESSAGE }),
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it('не ждёт завершения анализа перед подтверждением', async () => {
    // Промис, который никогда не разрешается: если бы вызов был с await,
    // подтверждение не дошло бы до клиента.
    vi.mocked(processDiaryEntry).mockReturnValue(new Promise(() => {}));

    await handleNutritionDiaryEntry(context(), 'Завтрак: овсянка');

    expect(processDiaryEntry).toHaveBeenCalledWith('diary-1');
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: CONFIRMATION_MESSAGE }),
    );
  });
});
