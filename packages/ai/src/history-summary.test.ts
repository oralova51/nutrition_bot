// Сводка истории уходит в промпт модели, поэтому «сегодня» здесь должно совпадать
// с локальными сутками клиента — теми же, по которым считается лимит рекомендаций.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDiaryEntry, makeQuestionnaire } from '@nutrition-bot/shared/testing';
import {
  buildHistorySummary,
  countEntriesOnLocalDay,
  addCalendarDays,
  listEntriesInLocalWindow,
} from './history-summary.js';
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

  it('отдаёт описания за 7 локальных дней и помечает текущую запись', () => {
    vi.setSystemTime(new Date('2026-01-15T09:00:00.000Z'));
    const current = makeDiaryEntry({
      id: 'diary-now',
      description: 'Выпила бокал пива',
      mealAt: new Date('2026-01-15T09:00:00.000Z'),
    });
    const sameWeek = makeDiaryEntry({
      id: 'diary-kuraga',
      description: 'Съела 5 ягод кураги',
      mealAt: new Date('2026-01-14T12:00:00.000Z'),
    });
    const tooOld = makeDiaryEntry({
      id: 'diary-old',
      description: 'Пицца',
      mealAt: new Date('2026-01-01T12:00:00.000Z'),
    });

    const summary = buildHistorySummary(
      input({ entry: current, history: [current, sameWeek, tooOld] }),
    );

    expect(summary).toContain('только что введена');
    expect(summary).toContain('2026-01-15: Выпила бокал пива [текущая]');
    expect(summary).toContain('2026-01-14: Съела 5 ягод кураги');
    expect(summary).not.toContain('Пицца');
  });

  it('добавляет текущую запись в окно, даже если её нет в history', () => {
    vi.setSystemTime(new Date('2026-01-15T09:00:00.000Z'));
    const current = makeDiaryEntry({
      id: 'diary-current',
      description: 'Бокал вина',
      mealAt: new Date('2026-01-15T09:00:00.000Z'),
    });
    const earlier = makeDiaryEntry({
      id: 'diary-2',
      description: 'Овсянка',
      mealAt: new Date('2026-01-15T06:00:00.000Z'),
    });

    const summary = buildHistorySummary(input({ entry: current, history: [earlier] }));

    expect(summary).toContain('Бокал вина [текущая]');
    expect(summary).toContain('Овсянка');
    expect(summary).toContain('Всего записей за курс: 1');
  });

  it('пишет заглушку, если в окне нет записей', () => {
    vi.setSystemTime(new Date('2026-01-15T09:00:00.000Z'));
    const old = makeDiaryEntry({
      id: 'diary-old',
      description: 'Ужин неделю назад',
      mealAt: new Date('2026-01-01T12:00:00.000Z'),
    });

    expect(buildHistorySummary(input({ entry: old, history: [old] }))).toContain(
      '(нет записей за окно)',
    );
  });

  it('обрезает длинное описание и подставляет заглушку для пустого', () => {
    vi.setSystemTime(new Date('2026-01-15T09:00:00.000Z'));
    const long = 'каша '.repeat(80).trim();
    const longEntry = makeDiaryEntry({
      id: 'diary-long',
      description: long,
      mealAt: new Date('2026-01-15T09:00:00.000Z'),
    });
    const empty = makeDiaryEntry({
      id: 'diary-empty',
      description: null,
      mealAt: new Date('2026-01-14T09:00:00.000Z'),
    });

    const summary = buildHistorySummary(input({ entry: longEntry, history: [longEntry, empty] }));

    expect(summary).toContain('…');
    expect(summary).not.toContain(long);
    expect(summary).toContain('(без описания)');
  });
});

describe('addCalendarDays и окно', () => {
  it('переносит дату через границу месяца', () => {
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addCalendarDays('2026-01-15', -6)).toBe('2026-01-09');
  });

  it('не включает записи старше окна', () => {
    vi.setSystemTime(new Date('2026-01-15T09:00:00.000Z'));
    const inside = makeDiaryEntry({
      id: 'in',
      mealAt: new Date('2026-01-09T05:00:00.000Z'),
      description: 'внутри',
    });
    const outside = makeDiaryEntry({
      id: 'out',
      mealAt: new Date('2026-01-08T05:00:00.000Z'),
      description: 'снаружи',
    });

    const listed = listEntriesInLocalWindow([inside, outside], TIMEZONE);

    expect(listed.map((item) => item.id)).toEqual(['in']);
  });

  it('возвращает пустой список, если записей нет', () => {
    expect(listEntriesInLocalWindow([], TIMEZONE)).toEqual([]);
  });

  it('принимает явное окно и сортирует записи одного дня по id', () => {
    vi.setSystemTime(new Date('2026-01-15T09:00:00.000Z'));
    const b = makeDiaryEntry({
      id: 'b',
      mealAt: new Date('2026-01-15T08:00:00.000Z'),
      description: 'вторая',
    });
    const a = makeDiaryEntry({
      id: 'a',
      mealAt: new Date('2026-01-15T07:00:00.000Z'),
      description: 'первая',
    });

    const listed = listEntriesInLocalWindow([b, a], TIMEZONE, 3);

    expect(listed.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
