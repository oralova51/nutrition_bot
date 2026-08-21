/**
 * Краткая сводка истории дневника для промпта: сколько записей уже было сегодня
 * и за весь курс. Используется и mock-движком, и реальным адаптером.
 */

import { formatZonedDate, type NutritionDiary } from '@nutrition-bot/shared';
import type { DiaryAnalysisInput } from './types.js';

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

export function buildHistorySummary(input: DiaryAnalysisInput): string {
  const todayCount = countEntriesOnLocalDay(input.history, input.clientContext.timezone);

  return [
    `За сегодня записей: ${todayCount}`,
    `Всего записей за курс: ${input.history.length}`,
    input.questionnaire ? 'Анкета клиента заполнена.' : 'Анкета не заполнена.',
  ].join('\n');
}
