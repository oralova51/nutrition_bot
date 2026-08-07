// Общие презентационные утилиты API, используемые несколькими сервисами.

import type { ClientEnrollment } from '@nutrition-bot/shared';

/** Формат отображения имени: имя + первая буква фамилии с точкой (adminAPI.md §4.3). */
export function displayName(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0);
  return initial ? `${firstName} ${initial}.` : firstName;
}

/**
 * Выбирает "текущий" enrollment: активный, либо enrollment с наибольшей startDate.
 * Используется в списке клиентов, compliance, статистике активности и т.д.
 */
export function pickCurrentEnrollment<T extends ClientEnrollment>(enrollments: T[]): T | null {
  if (enrollments.length === 0) {
    return null;
  }
  const active = enrollments.find((e) => e.status === 'active');
  if (active) {
    return active;
  }
  return [...enrollments].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] ?? null;
}

/** Экранирует ячейку CSV согласно RFC 4180 (запятые, кавычки, переносы строк, пробелы по краям). */
export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const stringValue = value === null || value === undefined ? '' : String(value);
  if (
    stringValue.includes(',') ||
    stringValue.includes('"') ||
    stringValue.includes('\n') ||
    stringValue.includes('\r') ||
    stringValue !== stringValue.trim()
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}
