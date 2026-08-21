/**
 * Краткая сводка истории дневника для промпта: сколько записей уже было сегодня
 * и за весь курс, плюс описания за 7 локальных дней — иначе модель не видит
 * паттерн «пиво уже не первый раз» и выдумывает связи вроде «после сладкого».
 */

import { formatZonedDate, type NutritionDiary } from '@nutrition-bot/shared';
import { TREAT_PATTERN_WINDOW_DAYS } from './treat-pattern.js';
import type { DiaryAnalysisInput } from './types.js';

export interface HistoryWindowEntry {
  id: string;
  localDate: string;
  description: string;
}

const DESCRIPTION_MAX_LENGTH = 200;

/**
 * Записи за локальные сутки клиента. Сравнение идёт по локальной дате, а не по
 * UTC: приём пищи в 01:00 по Калининграду — это ещё 23:00 предыдущего дня в UTC,
 * и по UTC-сравнению он бы не попал в «сегодня».
 */
export function countEntriesOnLocalDay(
  entries: NutritionDiary[],
  timezone: string,
  now: Date = new Date(),
): number {
  const today = formatZonedDate(now, timezone);
  return entries.filter((entry) => formatZonedDate(new Date(entry.mealAt), timezone) === today)
    .length;
}

/** Сдвиг календарной даты YYYY-MM-DD на целое число дней (без TZ). */
export function addCalendarDays(yyyyMmDd: string, deltaDays: number): string {
  const [year, month, day] = yyyyMmDd.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + deltaDays)).toISOString().slice(0, 10);
}

export function listEntriesInLocalWindow(
  entries: NutritionDiary[],
  timezone: string,
  windowDays: number = TREAT_PATTERN_WINDOW_DAYS,
  now: Date = new Date(),
): HistoryWindowEntry[] {
  const today = formatZonedDate(now, timezone);
  const start = addCalendarDays(today, -(windowDays - 1));

  return entries
    .map((entry) => ({
      id: entry.id,
      localDate: formatZonedDate(new Date(entry.mealAt), timezone),
      description: truncateDescription(entry.description),
    }))
    .filter((item) => item.localDate >= start && item.localDate <= today)
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.id.localeCompare(b.id));
}

export function buildHistorySummary(input: DiaryAnalysisInput): string {
  const timezone = input.clientContext.timezone;
  const todayCount = countEntriesOnLocalDay(input.history, timezone);
  const windowEntries = listEntriesInLocalWindow(
    historyWithCurrent(input.history, input.entry),
    timezone,
  );

  const lines: string[] = [
    `За сегодня записей: ${todayCount}`,
    `Всего записей за курс: ${input.history.length}`,
    input.questionnaire ? 'Анкета клиента заполнена.' : 'Анкета не заполнена.',
    'Текущая запись только что введена клиентом. Не пересказывай её («я вижу, что сегодня ты…») — клиент и так знает, что только что написал.',
    `Записи за последние ${TREAT_PATTERN_WINDOW_DAYS} локальных дней (для паттернов, не для пересказа):`,
  ];

  if (windowEntries.length === 0) {
    lines.push('(нет записей за окно)');
  } else {
    for (const item of windowEntries) {
      const marker = item.id === input.entry.id ? ' [текущая]' : '';
      lines.push(`- ${item.localDate}: ${item.description}${marker}`);
    }
  }

  return lines.join('\n');
}

function historyWithCurrent(history: NutritionDiary[], entry: NutritionDiary): NutritionDiary[] {
  if (history.some((item) => item.id === entry.id)) {
    return history;
  }
  return [entry, ...history];
}

function truncateDescription(description: string | null): string {
  const text = description?.trim() || '(без описания)';
  if (text.length <= DESCRIPTION_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, DESCRIPTION_MAX_LENGTH)}…`;
}
