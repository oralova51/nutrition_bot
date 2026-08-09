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
  ClientContext,
  DiaryAnalysisInput,
  DiaryAnalysisResult,
  EveningSummaryInput,
  EveningSummaryResult,
  RecommendationPriority,
  RecommendationProposal,
  RecommendationType,
} from './types.js';

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
    keywords: [
      'торт',
      'пирожное',
      'фастфуд',
      'бургер',
      'пицца',
      'чипсы',
      'колбаса',
      'жареная',
    ],
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

function buildHistorySummary(input: DiaryAnalysisInput): string {
  const today = new Date();
  const dayEntries = input.history.filter((entry) => {
    const entryDate = new Date(entry.mealAt);
    return (
      entryDate.getUTCFullYear() === today.getUTCFullYear() &&
      entryDate.getUTCMonth() === today.getUTCMonth() &&
      entryDate.getUTCDate() === today.getUTCDate()
    );
  });

  return [
    `За сегодня записей: ${dayEntries.length}`,
    `Всего записей за курс: ${input.history.length}`,
    input.questionnaire ? 'Анкета клиента заполнена.' : 'Анкета не заполнена.',
  ].join('\n');
}

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

export class MockAIEngine implements AIEngine {
  analyzeDiary(input: DiaryAnalysisInput): Promise<DiaryAnalysisResult> {
    const detected = detectCriteria(input.entry.description);
    const criteria = resolveCriteria(detected, input.entry);
    const historySummary = buildHistorySummary(input);

    const proposals: RecommendationProposal[] = criteria.map((criterion) => {
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
    const descriptions = input.dayEntries
      .map((entry) => (entry.description ?? '').toLowerCase())
      .filter(Boolean);
    const joined = descriptions.join(' | ');

    const hasProtein = CRITERIA_CONFIG.protein_deficit.keywords.some((k) => joined.includes(k));
    const hasVeggies = CRITERIA_CONFIG.vegetables_fiber_deficit.keywords.some((k) =>
      joined.includes(k),
    );
    const hasWater = CRITERIA_CONFIG.water.keywords.some((k) => joined.includes(k));
    const hasSugar = CRITERIA_CONFIG.sugar_fat_excess.keywords.some((k) => joined.includes(k));
    const hasSimpleCarbs = CRITERIA_CONFIG.simple_carbs_excess.keywords.some((k) =>
      joined.includes(k),
    );

    const enough: string[] = [
      `Ты сделал(а) ${input.dayEntries.length} запис(и/ей) о питании — это уже отличная привычка.`,
    ];
    if (hasProtein) enough.push('В рационе сегодня был белок — это поддерживает сытость.');
    if (hasVeggies) enough.push('Овощи/клетчатка сегодня тоже были — супер.');

    const missing: string[] = [];
    if (!hasWater) missing.push('Похоже, воды сегодня почти не отмечалось.');
    if (!hasProtein) missing.push('Источников белка за день почти не видно.');
    if (!hasVeggies) missing.push('Овощей и клетчатки сегодня мало.');

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
        'Часть простых углеводов можно заменить на более «длинные» (цельнозерновые) или дополнить овощами.',
      );
    }
    if (improvements.length === 0) {
      improvements.push('Завтра можно чуть равномернее распределить приёмы пищи в течение дня.');
    }

    const name = input.clientContext.firstName ?? 'друг';
    const summaryText = [
      `<b>Вечерняя сводка за ${input.localDate}</b>`,
      '',
      `Привет, ${name}! Вот мягкий взгляд на твой день:`,
      '',
      '<b>Что хватало</b>',
      ...enough.map((item) => `• ${item}`),
      '',
      '<b>Чего не хватало</b>',
      ...(missing.length > 0 ? missing : ['Явных дефицитов не видно — хороший день!']).map(
        (item) => `• ${item}`,
      ),
      '',
      '<b>Можно добавить</b>',
      ...toAdd.map((item) => `• ${item}`),
      '',
      '<b>Можно улучшить</b>',
      ...improvements.map((item) => `• ${item}`),
      '',
      'Спасибо, что делишься питанием — маленькие шаги складываются в привычку. 💚',
    ].join('\n');

    return Promise.resolve({
      enough,
      missing,
      toAdd,
      improvements,
      summaryText,
      metadata: {
        engine: 'mock',
        entriesCount: input.dayEntries.length,
        localDate: input.localDate,
      },
    });
  }
}
