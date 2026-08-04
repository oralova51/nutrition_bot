// Unit-тесты для чистых функций завершения курса (roadmap 7.14, idempotency, escapeHtml).
// Используем Vitest.

import { describe, expect, it } from 'vitest';
import {
  average,
  buildFeedbackKeyboard,
  buildMealsByHour,
  countCourseDays,
  escapeHtml,
  extractTopProblems,
  extractTopWords,
  formatReportMessage,
  generateAiSummary,
  getEnrollmentPeriodBounds,
  normalizeWord,
  percentage,
} from './course-completion.js';
import type { DiaryStats, Report } from '@nutrition-bot/shared';

describe('course-completion pure functions', () => {
  describe('escapeHtml', () => {
    it('escapes special HTML characters', () => {
      expect(escapeHtml('<script>&"')).toBe('&lt;script&gt;&amp;"');
    });

    it('returns plain text unchanged', () => {
      expect(escapeHtml('обычный текст')).toBe('обычный текст');
    });
  });

  describe('normalizeWord', () => {
    it('lowercases and removes punctuation', () => {
      expect(normalizeWord('БОРЩ!')).toBe('борщ');
      expect(normalizeWord('кефир,')).toBe('кефир');
    });
  });

  describe('extractTopWords', () => {
    it('returns most frequent non-stop words', () => {
      const entries = [
        { description: 'борщ хлеб борщ', status: 'filled' },
        { description: 'хлеб суп', status: 'filled' },
      ] as unknown as Parameters<typeof extractTopWords>[0];
      expect(extractTopWords(entries, 2)).toEqual(['борщ', 'хлеб']);
    });
  });

  describe('extractTopProblems', () => {
    it('detects problem keywords', () => {
      const entries = [
        { description: 'съел торт и пиццу', status: 'filled' },
        { description: 'опять сладкое', status: 'filled' },
      ] as unknown as Parameters<typeof extractTopProblems>[0];
      const problems = extractTopProblems(entries, 5);
      expect(problems.find((p) => p.area === 'торт')?.count).toBe(1);
      expect(problems.find((p) => p.area === 'сладкое')?.count).toBe(1);
    });
  });

  describe('buildMealsByHour', () => {
    it('groups meals by UTC hour', () => {
      const entries = [
        { mealAt: new Date('2026-08-01T09:00:00Z'), status: 'filled' },
        { mealAt: new Date('2026-08-01T09:30:00Z'), status: 'filled' },
        { mealAt: new Date('2026-08-01T13:00:00Z'), status: 'filled' },
      ] as unknown as Parameters<typeof buildMealsByHour>[0];
      expect(buildMealsByHour(entries)).toEqual({ 9: 2, 13: 1 });
    });
  });

  describe('average', () => {
    it('ignores null and undefined values', () => {
      expect(average([100, null, 200, undefined])).toBe(150);
    });

    it('returns null for empty valid values', () => {
      expect(average([null, undefined])).toBeNull();
    });
  });

  describe('percentage', () => {
    it('calculates rounded percentage', () => {
      expect(percentage(1, 3)).toBe(33);
    });

    it('returns null for zero total', () => {
      expect(percentage(0, 0)).toBeNull();
    });
  });

  describe('countCourseDays', () => {
    it('counts inclusive days', () => {
      expect(countCourseDays('2026-08-01', '2026-08-07')).toBe(7);
    });

    it('returns at least 1 day', () => {
      expect(countCourseDays('2026-08-01', '2026-08-01')).toBe(1);
    });
  });

  describe('getEnrollmentPeriodBounds', () => {
    it('returns start of startDate and end of endDate in UTC', () => {
      const bounds = getEnrollmentPeriodBounds({
        startDate: '2026-08-01',
        endDate: '2026-08-07',
      } as unknown as Parameters<typeof getEnrollmentPeriodBounds>[0]);
      expect(bounds.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(bounds.end.toISOString()).toBe('2026-08-07T23:59:59.999Z');
    });
  });

  describe('generateAiSummary', () => {
    it('includes days, records, calories and adherence', () => {
      const stats: DiaryStats = {
        totalDays: 7,
        totalRecords: 5,
        filledEntries: 4,
        avgCalories: 1500,
        topProducts: ['борщ', 'хлеб'],
      };
      const summary = generateAiSummary(stats, 75);
      expect(summary).toContain('Дней курса: 7');
      expect(summary).toContain('записей в дневнике: 5');
      expect(summary).toContain('Соблюдение рекомендаций: 75%');
      expect(summary).toContain('борщ');
    });
  });

  describe('formatReportMessage', () => {
    it('formats report and escapes user content', () => {
      const report = {
        periodStart: '2026-08-01',
        periodEnd: '2026-08-07',
        diaryStats: {
          totalDays: 7,
          totalRecords: 5,
          filledEntries: 4,
          avgCalories: 1500,
          topProducts: ['<скрипт>'],
          topProblems: ['сладкое'],
        },
        adherencePercent: 75,
        problemAreas: [{ area: '<проблема>', count: 1 }],
        aiSummary: 'Итоги курса.',
      } as unknown as Report;
      const message = formatReportMessage(report);
      expect(message).toContain('Дней курса: 7, записей: 5 (заполнено: 4)');
      expect(message).toContain('&lt;скрипт&gt;');
      expect(message).toContain('&lt;проблема&gt;');
      expect(message).toContain('Итоги курса.');
    });
  });

  describe('buildFeedbackKeyboard', () => {
    it('contains five star buttons', () => {
      const keyboard = buildFeedbackKeyboard();
      const buttons = keyboard.inline_keyboard[0];
      if (!buttons) {
        throw new Error('Expected first row of inline keyboard');
      }
      expect(buttons).toHaveLength(5);
      expect(buttons[0]!.callback_data).toBe('feedback:stars:1');
      expect(buttons[4]!.callback_data).toBe('feedback:stars:5');
    });
  });
});
