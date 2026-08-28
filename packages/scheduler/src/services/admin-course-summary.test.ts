import { describe, expect, it } from 'vitest';
import {
  formatAdminCourseCompletionMessage,
  formatClientDisplayName,
  formatQuestionnaireAnswer,
} from './admin-course-summary.js';

describe('formatQuestionnaireAnswer', () => {
  it('maps a single-choice value to its label', () => {
    expect(formatQuestionnaireAnswer('goal', 'weight_loss')).toBe('Снизить вес');
  });

  it('maps a multi-choice array to labels', () => {
    expect(formatQuestionnaireAnswer('obstacles', ['no_time', 'stress'])).toBe(
      'Не хватает времени, Испытываю постоянный стресс',
    );
  });

  it('appends free-text for the other option', () => {
    expect(
      formatQuestionnaireAnswer('obstacles', {
        values: ['other'],
        freeText: 'ночные смены',
      }),
    ).toBe('Другое: ночные смены');
  });

  it('formats approximate age and numeric weight', () => {
    expect(formatQuestionnaireAnswer('age', { value: 'около 30', approximate: true })).toBe(
      'около 30',
    );
    expect(formatQuestionnaireAnswer('weight', { value: 68.5, approximate: false })).toBe(
      '68.5 кг',
    );
  });

  it('returns null for empty answers', () => {
    expect(formatQuestionnaireAnswer('goal', undefined)).toBeNull();
    expect(formatQuestionnaireAnswer('goal', '')).toBeNull();
    expect(formatQuestionnaireAnswer('obstacles', [])).toBeNull();
  });
});

describe('formatClientDisplayName', () => {
  it('joins first and last name', () => {
    expect(formatClientDisplayName('Анна', 'Иванова')).toBe('Анна Иванова');
  });

  it('drops placeholder last name from admin invite', () => {
    expect(formatClientDisplayName('Анна', '-')).toBe('Анна');
  });
});

describe('formatAdminCourseCompletionMessage', () => {
  const report = {
    periodStart: '2026-08-01',
    periodEnd: '2026-08-30',
    diaryStats: {
      totalDays: 30,
      totalRecords: 42,
      filledEntries: 40,
      avgCalories: 1500,
      topProducts: ['борщ', '<скрипт>'],
    },
    adherencePercent: 75,
    problemAreas: [{ area: 'сладкое', count: 4 }],
  };

  it('builds a short client digest and nutrition summary', () => {
    const message = formatAdminCourseCompletionMessage({
      client: {
        firstName: 'Анна',
        lastName: 'Иванова',
        telegramId: '12345',
        telegramUsername: 'anna_fit',
      },
      enrollment: { startDate: '2026-08-01', endDate: '2026-08-30' },
      report,
      courseName: 'Курс 30 дней',
      answers: {
        goal: 'weight_loss',
        age: { value: 'около 30', approximate: true },
        weight: { value: 68.5, approximate: false },
        obstacles: ['no_time'],
        health: ['none'],
      },
    });

    expect(message).toContain('Курс завершён');
    expect(message).toContain('Анна Иванова');
    expect(message).toContain('@anna_fit');
    expect(message).toContain('id 12345');
    expect(message).toContain('Курс 30 дней');
    expect(message).toContain('2026-08-01 — 2026-08-30 (30 дн.)');
    expect(message).toContain('Цель: Снизить вес');
    expect(message).toContain('Возраст: около 30');
    expect(message).toContain('Вес: 68.5 кг');
    expect(message).toContain('Что мешает: Не хватает времени');
    expect(message).toContain('Здоровье: Нет');
    expect(message).toContain('40 заполнено / 42 записей за 30 дн.');
    expect(message).toContain('Средняя калорийность: 1500 ккал/день');
    expect(message).toContain('Соблюдение рекомендаций: 75%');
    expect(message).toContain('борщ');
    expect(message).toContain('Проблемы: сладкое');
    expect(message).toContain('&lt;скрипт&gt;');
    expect(message).not.toContain('<скрипт>');
  });

  it('omits questionnaire and calories when data is missing', () => {
    const message = formatAdminCourseCompletionMessage({
      client: {
        firstName: 'Марина',
        lastName: '-',
        telegramId: '99',
        telegramUsername: null,
      },
      enrollment: { startDate: '2026-08-01', endDate: '2026-08-07' },
      report: {
        periodStart: '2026-08-01',
        periodEnd: '2026-08-07',
        diaryStats: { totalDays: 7, totalRecords: 0, filledEntries: 0, avgCalories: null },
        adherencePercent: null,
        problemAreas: [],
      },
      answers: {},
    });

    expect(message).toContain('Клиент:</b> Марина');
    expect(message).toContain('id 99');
    expect(message).not.toContain('<b>Анкета</b>');
    expect(message).toContain('нет записей за 7 дн.');
    expect(message).not.toContain('Средняя калорийность');
    expect(message).not.toContain('Соблюдение рекомендаций');
  });
});
