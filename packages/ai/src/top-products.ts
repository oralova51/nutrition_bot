/**
 * Топ продуктов для итогового отчёта (ФТ-14).
 * Эвристика — mock-движок и fallback, если модель вернула мусор или воду.
 */

import type { NutritionDiary } from '@nutrition-bot/shared';

export const DEFAULT_TOP_PRODUCTS_LIMIT = 5;

const STOP_WORDS = new Set([
  'и',
  'в',
  'на',
  'с',
  'по',
  'к',
  'а',
  'не',
  'я',
  'что',
  'как',
  'до',
  'для',
  'за',
  'от',
  'из',
  'у',
  'же',
  'то',
  'бы',
  'ли',
  'но',
  'это',
  'так',
  'тут',
  'там',
  'при',
  'под',
  'про',
  'над',
  'без',
  'во',
  'со',
  'около',
  'после',
  'мне',
  'меня',
  'мой',
  'моя',
  'мои',
  'моё',
  'моего',
  'моей',
  'моих',
  'съел',
  'съела',
  'съели',
  'ела',
  'ел',
  'ели',
  'пила',
  'пил',
  'пили',
  'выпил',
  'выпила',
  'выпили',
  'поел',
  'поела',
  'поели',
  'завтрак',
  'завтракал',
  'завтракала',
  'обед',
  'обедал',
  'обедала',
  'ужин',
  'ужинал',
  'ужинала',
  'перекус',
  'перекусил',
  'перекусила',
  'сегодня',
  'вчера',
  'утром',
  'днем',
  'днём',
  'вечером',
  'ночью',
  'просто',
  'только',
  'чуть',
  'немного',
  'немножко',
  'много',
  'мало',
  'примерно',
  'ещё',
  'еще',
]);

/** Единицы и маркеры порции — не продукты. */
export const QUANTITY_MARKERS: ReadonlySet<string> = new Set([
  'грамм',
  'грамма',
  'граммов',
  'граммах',
  'грам',
  'гр',
  'г',
  'кг',
  'мл',
  'литр',
  'литра',
  'литров',
  'шт',
  'штук',
  'штука',
  'штуки',
  'ломтик',
  'ломтика',
  'ломтиков',
  'чашка',
  'чашки',
  'чашек',
  'стакан',
  'стакана',
  'стаканов',
  'бокал',
  'бокала',
  'бокалов',
  'тарелка',
  'тарелки',
  'тарелок',
  'кусок',
  'куска',
  'кусков',
  'порция',
  'порции',
  'порций',
  'бутылка',
  'бутылки',
  'бутылок',
  'банка',
  'банки',
  'банок',
  'упаковка',
  'упаковки',
  'упаковок',
  'пачка',
  'пачки',
  'пачек',
  'ложка',
  'ложки',
  'ложек',
  'столовая',
  'чайная',
  'горсть',
  'щепотка',
  'долька',
  'дольки',
  'долек',
  'половина',
  'половинка',
  'целый',
  'целая',
  'целое',
  'полный',
  'полная',
  'полное',
  'большой',
  'большая',
  'большое',
  'маленький',
  'маленькая',
  'маленькое',
  'средний',
  'средняя',
  'среднее',
  'сто',
  'двести',
  'триста',
  'тысяча',
  'тысячи',
  'тысяч',
]);

/** Простая вода и её словоформы — не входит в топ продуктов. */
const WATER_TOKENS = new Set([
  'вода',
  'воды',
  'воде',
  'воду',
  'водой',
  'водою',
  'водичка',
  'водички',
  'водичке',
  'водичку',
  'водичкой',
  'водица',
  'водицы',
  'водице',
  'водицу',
  'минералка',
  'минералки',
  'минералку',
  'минералкой',
  'минеральная',
  'минеральной',
  'минеральную',
  'питьевая',
  'питьевой',
  'питьевую',
  'газированная',
  'газированной',
  'газированную',
  'water',
]);

const MAX_PRODUCT_LENGTH = 40;

export function tokenizeProductText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d+)([а-яёa-z]+)/gi, '$1 $2')
    .replace(/[^a-zа-яё0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function isWaterToken(token: string): boolean {
  return WATER_TOKENS.has(token.toLowerCase());
}

function isNoiseToken(token: string): boolean {
  if (/^\d+$/.test(token)) return true;
  if (token.length < 3 && !QUANTITY_MARKERS.has(token)) return true;
  return STOP_WORDS.has(token) || QUANTITY_MARKERS.has(token) || isWaterToken(token);
}

function normalizeCandidate(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^а-яёa-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Убирает из ответа модели воду, единицы и пустые строки.
 * Чай/кофе и прочие напитки остаются.
 */
export function sanitizeTopProducts(products: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of products) {
    if (result.length >= limit) break;
    const normalized = normalizeCandidate(String(raw ?? ''));
    if (!normalized || normalized.length > MAX_PRODUCT_LENGTH) continue;

    const tokens = tokenizeProductText(normalized);
    const meaningful = tokens.filter((token) => !isNoiseToken(token));
    if (meaningful.length === 0) continue;

    const key = meaningful.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }

  return result;
}

export function extractTopProductsHeuristic(
  entries: NutritionDiary[],
  limit: number = DEFAULT_TOP_PRODUCTS_LIMIT,
): string[] {
  const frequency = new Map<string, number>();

  for (const entry of entries) {
    const text = entry.description ?? '';
    for (const token of tokenizeProductText(text)) {
      if (isNoiseToken(token) || token.length < 3) continue;
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    .slice(0, limit)
    .map(([word]) => word);
}

/** Если модель вернула мало валидных пунктов — добираем эвристикой. */
export function finalizeTopProducts(
  candidates: string[],
  entries: NutritionDiary[],
  limit: number = DEFAULT_TOP_PRODUCTS_LIMIT,
): string[] {
  const cleaned = sanitizeTopProducts(candidates, limit);
  if (cleaned.length >= limit) return cleaned;

  const seen = new Set(cleaned);
  for (const item of extractTopProductsHeuristic(entries, limit)) {
    if (cleaned.length >= limit) break;
    if (seen.has(item)) continue;
    seen.add(item);
    cleaned.push(item);
  }
  return cleaned;
}

export function formatDiaryEntriesForTopProducts(
  entries: NutritionDiary[],
  maxEntries = 150,
  maxDescriptionLength = 180,
): string {
  return entries
    .slice(0, maxEntries)
    .map((entry, index) => {
      const description = (entry.description ?? '').trim().slice(0, maxDescriptionLength);
      return `${index + 1}. ${description || '(без описания)'}`;
    })
    .join('\n');
}
