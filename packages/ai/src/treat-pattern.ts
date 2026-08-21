/**
 * Классификация «удовольствий» для правила ФТ-7: разовый treat — молчим,
 * повтор того же класса за окно — частотная рамка, не замена продукта.
 */

export type TreatClass = 'alcohol' | 'sweets' | 'junk';

export const TREAT_PATTERN_WINDOW_DAYS = 7;
export const TREAT_PATTERN_MIN_COUNT = 2;

const TREAT_CLASS_ORDER: readonly TreatClass[] = ['alcohol', 'sweets', 'junk'];

/** Токен совпадает или начинается с основы, кроме явных исключений (вино ≠ виноград). */
const TREAT_STEMS: Record<TreatClass, { stems: readonly string[]; exclude: readonly string[] }> = {
  alcohol: {
    stems: [
      'пив',
      'вин',
      'водк',
      'виски',
      'коньяк',
      'шампан',
      'коктейл',
      'ликер',
      'ликёр',
      'сидр',
      'алкогол',
      'мохито',
      'мартини',
    ],
    exclude: ['виноград', 'винил', 'винтик', 'винт', 'винегрет', 'свинин'],
  },
  sweets: {
    stems: [
      'торт',
      'пирожн',
      'конфет',
      'шоколад',
      'морожен',
      'печенье',
      'печеньк',
      'пончик',
      'десерт',
      'варень',
    ],
    exclude: [],
  },
  junk: {
    stems: ['чипс', 'фастфуд', 'бургер', 'пицц', 'наггетс', 'хотдог', 'хот-дог'],
    exclude: [],
  },
};

export function detectTreatClass(description: string | null | undefined): TreatClass | null {
  if (!description?.trim()) return null;
  const tokens = tokenize(description);
  // «картошка фри» — два токена, стемом не ловится.
  const joined = tokens.join(' ');
  if (joined.includes('картошка фри') || joined.includes('картофель фри')) {
    return 'junk';
  }

  for (const treatClass of TREAT_CLASS_ORDER) {
    const { stems, exclude } = TREAT_STEMS[treatClass];
    const matched = tokens.some((token) => {
      if (exclude.some((prefix) => token.startsWith(prefix))) {
        return false;
      }
      return stems.some((stem) => token.startsWith(stem));
    });
    if (matched) {
      return treatClass;
    }
  }
  return null;
}

export function countTreatClass(
  entries: ReadonlyArray<{ description?: string | null }>,
  treatClass: TreatClass,
): number {
  return entries.filter((entry) => detectTreatClass(entry.description) === treatClass).length;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zа-яё0-9-]+/gi, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}
