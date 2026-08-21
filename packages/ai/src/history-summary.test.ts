// Сводка истории уходит в промпт модели, поэтому «сегодня» здесь должно совпадать
// с локальными сутками клиента — теми же, по которым считается лимит рекомендаций.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDiaryEntry, makeQuestionnaire } from '@nutrition-bot/shared/testing';
import { buildHistorySummary, countEntriesOnLocalDay } from './history-summary.js';
import type { ClientContext, DiaryAnalysisInput } from './types.js';

const TIMEZONE = 'Europe/Kaliningrad';
const clientContext: ClientContext = { firstName: 'Анна', timezone: TIMEZONE };

/** 15 января 2026, 01:30 по Калининграду — по UTC это ещё 14 января, 23:30. */
const LOCAL_NIGHT = new Date('2026-01-14T23:30:00.000Z');

function input(overrides: Partial<DiaryAnalysisInput> = {}): DiaryAnalysisInput {
  const entry = makeDiaryEntry();
  return { entry, history: [entry], clientContext, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('countEntriesOnLocalDay', () => {
  it('считает ночную запись сегодняшней, хотя по UTC это предыдущий день', () => {
    vi.setSystemTime(LOCAL_NIGHT);
    const nightEntry = makeDiaryEntry({ id: 'diary-night', mealAt: LOCAL_NIGHT });

    expect(countEntriesOnLocalDay([nightEntry], TIMEZONE)).toBe(1);
  });

  it('не считает вчерашний вечер, хотя по UTC это те же сутки', () => {
    vi.setSystemTime(LOCAL_NIGHT);
    // 14 января, 22:00 по Калининграду = 20:00 UTC того же UTC-дня, но локально это вчера.
    const yesterdayEvening = makeDiaryEntry({
      id: 'diary-yesterday',
      mealAt: new Date('2026-01-14T20:00:00.000Z'),
    });

    expect(countEntriesOnLocalDay([yesterdayEvening], TIMEZONE)).toBe(0);
  });

  it('считает только записи текущих локальных суток', () => {
    vi.setSystemTime(new Date('2026-01-15T09:00:00.000Z'));
    const entries = [
      makeDiaryEntry({ id: 'diary-1', mealAt: new Date('2026-01-15T06:00:00.000Z') }),
      makeDiaryEntry({ id: 'diary-2', mealAt: new Date('2026-01-15T08:30:00.000Z') }),
      makeDiaryEntry({ id: 'diary-3', mealAt: new Date('2026-01-13T08:30:00.000Z') }),
    ];

    expect(countEntriesOnLocalDay(entries, TIMEZONE)).toBe(2);
  });
});

describe('buildHistorySummary', () => {
  it('разделяет счётчик за сегодня и за весь курс', () => {
    vi.setSystemTime(new Date('2026-01-15T09:00:00.000Z'));
    const history = [
      makeDiaryEntry({ id: 'diary-1', mealAt: new Date('2026-01-15T06:00:00.000Z') }),
      makeDiaryEntry({ id: 'diary-2', mealAt: new Date('2026-01-10T06:00:00.000Z') }),
    ];

    const summary = buildHistorySummary(input({ history }));

    expect(summary).toContain('За сегодня записей: 1');
    expect(summary).toContain('Всего записей за курс: 2');
  });

  it('сообщает модели о наличии анкеты', () => {
    vi.setSystemTime(new Date('2026-01-15T09:00:00.000Z'));

    expect(buildHistorySummary(input())).toContain('Анкета не заполнена.');
    expect(buildHistorySummary(input({ questionnaire: makeQuestionnaire() }))).toContain(
      'Анкета клиента заполнена.',
    );
  });
});
