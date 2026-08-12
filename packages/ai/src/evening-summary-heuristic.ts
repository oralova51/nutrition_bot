/**
 * Эвристическая вечерняя сводка по записям дня.
 * Используется mock-движком и как fallback, если AI вернул битый/обрезанный JSON.
 */

import type { NutritionDiary } from '@nutrition-bot/shared';
import type { ClientContext, EveningSummaryResult } from './types.js';

const PROTEIN_KEYWORDS = [
  'курица',
  'рыба',
  'яйцо',
  'яйца',
  'творог',
  'сыр',
  'мясо',
  'индейка',
  'бобов',
  'нут',
  'чечевица',
  'протеин',
  'йогурт',
];

const VEGGIE_KEYWORDS = [
  'салат',
  'овощи',
  'огурец',
  'помидор',
  'капуста',
  'морковь',
  'шпинат',
  'брокколи',
  'клетчатка',
  'зелень',
];

const WATER_KEYWORDS = ['вода', 'воды', 'выпил', 'выпила', 'чай', 'кофе', 'сок', 'компот'];

const SUGAR_FAT_KEYWORDS = [
  'торт',
  'пирожное',
  'фастфуд',
  'бургер',
  'пицца',
  'чипсы',
  'колбаса',
  'жареная',
  'шоколад',
  'конфет',
];

const SIMPLE_CARBS_KEYWORDS = [
  'хлеб',
  'булка',
  'макароны',
  'рис',
  'картофель',
  'картошка',
  'пирог',
  'блины',
  'блин',
  'варенье',
  'мед',
  'сахар',
];

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function formatMealsOverview(dayEntries: NutritionDiary[]): string[] {
  return dayEntries.map((entry, index) => {
    const description = entry.description?.trim() || '(без описания)';
    const calories =
      typeof entry.approxCalories === 'number' ? ` (~${entry.approxCalories} ккал)` : '';
    return `${index + 1}. ${description}${calories}`;
  });
}

/** Собирает блоки и готовый текст сводки по ключевым словам в записях дня. */
export function buildHeuristicEveningSummary(
  dayEntries: NutritionDiary[],
  localDate: string,
  clientContext: ClientContext,
): EveningSummaryResult {
  const descriptions = dayEntries
    .map((entry) => (entry.description ?? '').toLowerCase())
    .filter(Boolean);
  const joined = descriptions.join(' | ');

  const hasProtein = hasAny(joined, PROTEIN_KEYWORDS);
  const hasVeggies = hasAny(joined, VEGGIE_KEYWORDS);
  const hasWater = hasAny(joined, WATER_KEYWORDS);
  const hasSugar = hasAny(joined, SUGAR_FAT_KEYWORDS);
  const hasSimpleCarbs = hasAny(joined, SIMPLE_CARBS_KEYWORDS);

  const enough: string[] = [
    `За день отмечено ${dayEntries.length} приём(а/ов) пищи — это уже хорошая база для анализа.`,
  ];
  if (hasProtein) enough.push('В рационе был белок — это поддерживает сытость и восстановление.');
  if (hasVeggies)
    enough.push('Овощи/клетчатка сегодня тоже были — отличная поддержка пищеварения.');
  if (hasWater) enough.push('Жидкость в записях отмечена — так проще держать водный баланс.');

  const missing: string[] = [];
  if (!hasWater) missing.push('Похоже, воды и напитков сегодня почти не отмечалось.');
  if (!hasProtein) missing.push('Источников белка за день почти не видно.');
  if (!hasVeggies) missing.push('Овощей и клетчатки сегодня мало.');
  if (missing.length === 0) {
    missing.push('Явных дефицитов по базовым группам не видно — хороший день.');
  }

  const toAdd: string[] = [];
  if (!hasWater) toAdd.push('Добавь 1–2 стакана воды к основным приёмам пищи.');
  if (!hasProtein) toAdd.push('Добавь яйцо, творог, курицу или рыбу хотя бы к одному приёму.');
  if (!hasVeggies) toAdd.push('Добавь небольшой салат или свежие овощи к обеду/ужину.');
  if (toAdd.length === 0) toAdd.push('Продолжай в том же духе и сохрани разнообразие завтра.');

  const improvements: string[] = [];
  if (hasSugar) {
    improvements.push(
      'Если тянет на сладкое/жирное — можно чуть уменьшить порцию и добавить белок рядом.',
    );
  }
  if (hasSimpleCarbs) {
    improvements.push(
      'Часть простых углеводов можно заменить на более «длинные» или дополнить овощами и белком.',
    );
  }
  if (improvements.length === 0) {
    improvements.push('Завтра можно чуть равномернее распределить приёмы пищи в течение дня.');
  }

  const name = clientContext.firstName ?? 'друг';
  const meals = formatMealsOverview(dayEntries);
  const summaryText = [
    `<b>Вечерняя сводка за ${localDate}</b>`,
    '',
    `Привет, ${name}! Вот мягкий разбор твоего дня:`,
    '',
    '<b>Что было сегодня</b>',
    ...meals.map((item) => `• ${item}`),
    '',
    '<b>Что хватало</b>',
    ...enough.map((item) => `• ${item}`),
    '',
    '<b>Чего не хватало</b>',
    ...missing.map((item) => `• ${item}`),
    '',
    '<b>Можно добавить</b>',
    ...toAdd.map((item) => `• ${item}`),
    '',
    '<b>Можно улучшить</b>',
    ...improvements.map((item) => `• ${item}`),
    '',
    'Спасибо, что делишься питанием — маленькие шаги складываются в привычку.',
  ].join('\n');

  return {
    enough,
    missing,
    toAdd,
    improvements,
    summaryText,
    metadata: {
      engine: 'heuristic',
      entriesCount: dayEntries.length,
      localDate,
    },
  };
}

/** Собирает HTML-текст из блоков AI; если блоки пустые — возвращает null. */
export function composeEveningSummaryText(
  localDate: string,
  enough: string[],
  missing: string[],
  toAdd: string[],
  improvements: string[],
  firstName?: string | null,
): string | null {
  const hasBlocks =
    enough.length > 0 || missing.length > 0 || toAdd.length > 0 || improvements.length > 0;
  if (!hasBlocks) return null;

  const name = firstName ?? 'друг';
  const lines = [
    `<b>Вечерняя сводка за ${localDate}</b>`,
    '',
    `Привет, ${name}! Вот мягкий разбор твоего дня:`,
    '',
  ];
  if (enough.length > 0) {
    lines.push('<b>Что хватало</b>', ...enough.map((item) => `• ${item}`), '');
  }
  if (missing.length > 0) {
    lines.push('<b>Чего не хватало</b>', ...missing.map((item) => `• ${item}`), '');
  }
  if (toAdd.length > 0) {
    lines.push('<b>Можно добавить</b>', ...toAdd.map((item) => `• ${item}`), '');
  }
  if (improvements.length > 0) {
    lines.push('<b>Можно улучшить</b>', ...improvements.map((item) => `• ${item}`), '');
  }
  lines.push('Спасибо, что делишься питанием — до завтра!');
  return lines.join('\n');
}
