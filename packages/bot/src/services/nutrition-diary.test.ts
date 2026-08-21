// Roadmap 13.4: анализ AI не должен влиять на подтверждение записи дневника.
// Запись сохраняется и подтверждается синхронно, а processDiaryEntry запускается
// фоном — падение или зависание модели клиент видеть не должен.
// Roadmap 13.6: разбор текста записи (время приёма и калорийность) — быстрые
// проверки без БД, чтобы регрессия ловилась в `npm test`, а не только в сценарном наборе.

import { format, toZonedTime } from 'date-fns-tz';
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

function createdEntry(): { description: string; mealAt: Date; approxCalories: number | null } {
  const call = vi.mocked(NutritionDiary.create).mock.calls[0]?.[0];
  if (!call) {
    throw new Error('NutritionDiary.create не вызывался');
  }
  return call as { description: string; mealAt: Date; approxCalories: number | null };
}

function localTime(date: Date): string {
  return format(toZonedTime(date, 'Europe/Kaliningrad'), 'HH:mm', {
    timeZone: 'Europe/Kaliningrad',
  });
}

describe('handleNutritionDiaryEntry — разбор текста', () => {
  it('берёт время из явного указания «в 14:30»', async () => {
    await handleNutritionDiaryEntry(context(), 'в 14:30 борщ с хлебом');

    expect(localTime(createdEntry().mealAt)).toBe('14:30');
  });

  it('находит время и в середине фразы', async () => {
    await handleNutritionDiaryEntry(context(), 'съела творог в 8.15 утром');

    expect(localTime(createdEntry().mealAt)).toBe('08:15');
  });

  it('подставляет время по ключевому слову приёма пищи', async () => {
    await handleNutritionDiaryEntry(context(), 'на ужин рыба с овощами');

    expect(localTime(createdEntry().mealAt)).toBe('19:00');
  });

  it('извлекает калорийность и убирает её из описания', async () => {
    await handleNutritionDiaryEntry(context(), 'овсянка с бананом 350 ккал');

    expect(createdEntry()).toMatchObject({
      description: 'овсянка с бананом',
      approxCalories: 350,
    });
  });

  it('понимает вариант «калорий»', async () => {
    await handleNutritionDiaryEntry(context(), 'салат 200 калорий');

    expect(createdEntry().approxCalories).toBe(200);
  });

  it('не принимает за калории похожее слово', async () => {
    await handleNutritionDiaryEntry(context(), '2 калача с чаем');

    expect(createdEntry()).toMatchObject({
      description: '2 калача с чаем',
      approxCalories: null,
    });
  });

  it('игнорирует недопустимое время и оставляет текущий момент', async () => {
    await handleNutritionDiaryEntry(context(), 'в 33:99 что-то съел');

    // Некорректное время не должно подменять описание или ронять обработку.
    expect(createdEntry().description).toBe('в 33:99 что-то съел');
  });
});
