/**
 * Mock-реализация AIEngine для dev и тестов.
 * Roadmap 5.1: интерфейс + mock-реализация.
 *
 * Анализ выполняется простой эвристикой по ключевым словам.
 * Не делает внешних вызовов — быстрая и детерминированная.
 */

import { randomUUID } from 'node:crypto';
import type {
  AIEngine,
  AnalysisCriterion,
  ClarityCheckInput,
  ClarityCheckResult,
  ClarityMissingField,
  ClientContext,
  DiaryAnalysisInput,
  DiaryAnalysisResult,
  EveningSummaryInput,
  EveningSummaryResult,
  RecommendationPriority,
  RecommendationProposal,
  RecommendationType,
} from './types.js';
import { buildHeuristicEveningSummary } from './evening-summary-heuristic.js';
import { buildHistorySummary } from './history-summary.js';

const CRITERIA_CONFIG: Record<
  AnalysisCriterion,
  {
    keywords: string[];
    type: RecommendationType;
    priority: RecommendationPriority;
    rationale: string;
    draftText: string;
  }
> = {
  water: {
    keywords: ['вода', 'воды', 'выпил', 'выпила', 'чай', 'кофе', 'сок', 'компот', 'лимонад'],
    type: 'habit',
    priority: 'medium',
    rationale: 'В записи не упомянуто потребление воды.',
    draftText:
      'Попробуй добавить стакан воды к следующему приёму пищи — это поможет организму лучше усваивать пищу и поддерживать энергию.',
  },
  sugar_fat_excess: {
    keywords: ['торт', 'пирожное', 'фастфуд', 'бургер', 'пицца', 'чипсы', 'колбаса', 'жареная'],
    type: 'product',
    priority: 'high',
    rationale: 'В записи присутствуют сладкие или жирные продукты.',
    draftText:
      'Сладкое и жирное иногда хочется всем — попробуй в следующий раз взять чуть меньшую порцию или добавить белок, чтобы насыщение держалось дольше.',
  },
  protein_deficit: {
    keywords: [
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
    ],
    type: 'habit',
    priority: 'high',
    rationale: 'В записи не видно источников белка.',
    draftText:
      'Добавь к приёму пищи немного белка: яйцо, творог, курицу или рыбу — это поможет сохранить силы и мышцы.',
  },
  snacking_overeating: {
    keywords: [
      'перекус',
      'перекусил',
      'перекусила',
      'закусил',
      'закусила',
      'дополнительно',
      'еще',
      'ещё',
      'второй',
      'третий',
    ],
    type: 'regimen',
    priority: 'medium',
    rationale: 'Возможно, это лишний перекус между основными приёмами.',
    draftText:
      'Если между приёмами хочется есть, попробуй выпить воды или съесть немного орехов — иногда жажд маскируется под голод.',
  },
  vegetables_fiber_deficit: {
    keywords: [
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
    ],
    type: 'product',
    priority: 'medium',
    rationale: 'В записи мало овощей и клетчатки.',
    draftText:
      'Овощи добавляют объёма и клетчатки — попробуй добавить к этому приёму пищи небольшой салат или свежие овощи.',
  },
  simple_carbs_excess: {
    keywords: [
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
      // «конфет» ловит конфета/конфеты/конфет/конфету
      'конфет',
      'шоколад',
    ],
    type: 'product',
    priority: 'medium',
    rationale: 'В записи много простых углеводов.',
    draftText:
      'Простые углеводы дают быструю энергию, но быстро уходят. Попробуй заменить часть на цельнозерновые или добавить белок и овощи.',
  },
};

const EXCESS_CRITERIA: AnalysisCriterion[] = [
  'sugar_fat_excess',
  'snacking_overeating',
  'simple_carbs_excess',
];

const DEFICIT_CRITERIA: AnalysisCriterion[] = [
  'water',
  'protein_deficit',
  'vegetables_fiber_deficit',
];

function hasKeyword(description: string, keywords: string[]): boolean {
  const lower = description.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

/**
 * Excess-критерии срабатывают при наличии ключевых слов.
 * Deficit-критерии — когда маркеров в тексте нет (и только если нет excess-находок).
 */
function detectCriteria(description: string | null): AnalysisCriterion[] {
  if (!description?.trim()) return [];

  const excessFound = EXCESS_CRITERIA.filter((criterion) =>
    hasKeyword(description, CRITERIA_CONFIG[criterion].keywords),
  );
  if (excessFound.length > 0) {
    return excessFound;
  }

  return DEFICIT_CRITERIA.filter(
    (criterion) => !hasKeyword(description, CRITERIA_CONFIG[criterion].keywords),
  );
}

const PRIORITY_ORDER: Record<RecommendationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function pickTopCriteria(criteria: AnalysisCriterion[]): AnalysisCriterion[] {
  if (criteria.length <= 1) return criteria;
  return [...criteria]
    .sort(
      (a, b) =>
        PRIORITY_ORDER[CRITERIA_CONFIG[a].priority] - PRIORITY_ORDER[CRITERIA_CONFIG[b].priority],
    )
    .slice(0, 1);
}

function resolveCriteria(
  detected: AnalysisCriterion[],
  entry: DiaryAnalysisInput['entry'],
): AnalysisCriterion[] {
  // Если есть только фото без подписи — не угадываем.
  if (entry.hasPhoto && !entry.description) return [];

  if (detected.length > 0) return detected;

  // Мягкий fallback, если текст есть, но эвристика ничего не нашла.
  if (entry.description?.trim()) {
    return ['water', 'vegetables_fiber_deficit'];
  }

  return [];
}

const COMMON_WORDS: ReadonlySet<string> = new Set([
  'я',
  'съел',
  'съела',
  'съели',
  'поел',
  'поела',
  'поели',
  'выпил',
  'выпила',
  'выпили',
  'ел',
  'ела',
  'ели',
  'пил',
  'пила',
  'пили',
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
  'на',
  'в',
  'с',
  'по',
  'и',
  'к',
  'за',
  'под',
  'из',
  'под',
  'просто',
  'только',
  'чуть',
  'чуток',
  'немного',
  'немножко',
  'много',
  'мало',
  'сегодня',
  'утром',
  'днем',
  'вечером',
  'ночью',
  'вчера',
  'сейчас',
  'потом',
  'позже',
]);

const QUANTITY_MARKERS: ReadonlySet<string> = new Set([
  'грамм',
  'грам',
  'гр',
  'кг',
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
  'столовая',
  'чайная',
  'горсть',
  'щепотка',
  'долька',
  'дольки',
  'долек',
  'сто',
  'тысяча',
  'тысячи',
  'тысяч',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function hasProductToken(description: string): boolean {
  const tokens = tokenize(description);
  return tokens.some(
    (token) =>
      !COMMON_WORDS.has(token) &&
      !QUANTITY_MARKERS.has(token) &&
      !/^\d+$/.test(token),
  );
}

function hasQuantityMarker(description: string): boolean {
  const tokens = tokenize(description);
  if (/\d/.test(description)) return true;
  return tokens.some((token) => QUANTITY_MARKERS.has(token));
}

function checkClarityHeuristic(description: string): ClarityCheckResult {
  const normalized = description.trim();
  const missingFields: ClarityMissingField[] = [];

  if (normalized.length < 3 || !/[a-zA-Zа-яА-ЯёЁ]/.test(normalized)) {
    missingFields.push('product');
  } else if (!hasProductToken(normalized)) {
    missingFields.push('product');
  }

  if (missingFields.length === 0 && !hasQuantityMarker(normalized)) {
    missingFields.push('quantity');
  }

  if (missingFields.length === 0) {
    return { needsClarification: false, missingFields: [], question: null };
  }

  const question =
    missingFields[0] === 'product'
      ? 'Что именно вы съели или выпили?'
      : 'Сколько это было примерно? Например, «2 яйца» или «тарелка супа».';

  return { needsClarification: true, missingFields, question };
}

export class MockAIEngine implements AIEngine {
  analyzeDiary(input: DiaryAnalysisInput): Promise<DiaryAnalysisResult> {
    const detected = detectCriteria(input.entry.description);
    const criteria = resolveCriteria(detected, input.entry);
    const historySummary = buildHistorySummary(input);

    const proposals: RecommendationProposal[] = pickTopCriteria(criteria).map((criterion) => {
      const config = CRITERIA_CONFIG[criterion];
      return {
        id: randomUUID(),
        criterion,
        type: config.type,
        priority: config.priority,
        rationale: `${config.rationale} (контекст: ${historySummary.replace(/\n/g, '; ')})`,
        draftText: config.draftText,
      };
    });

    return Promise.resolve({
      proposals,
      metadata: {
        engine: 'mock',
        criteria,
        historySummary,
      },
    });
  }

  generateRecommendationText(
    proposal: RecommendationProposal,
    _context: ClientContext,
  ): Promise<string> {
    void _context;
    // В mock-режиме просто возвращаем черновик, без обращения к AI.
    return Promise.resolve(proposal.draftText);
  }

  generateEveningSummary(input: EveningSummaryInput): Promise<EveningSummaryResult> {
    const result = buildHeuristicEveningSummary(
      input.dayEntries,
      input.localDate,
      input.clientContext,
    );
    return Promise.resolve({
      ...result,
      metadata: {
        ...result.metadata,
        engine: 'mock',
      },
    });
  }

  checkDiaryClarity(input: ClarityCheckInput): Promise<ClarityCheckResult> {
    void input.clientContext;
    return Promise.resolve(checkClarityHeuristic(input.description));
  }
}
