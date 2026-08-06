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
  DiaryAnalysisInput,
  DiaryAnalysisResult,
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
      'конфета',
      'шоколад',
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
      'варенье',
      'мед',
      'сахар',
    ],
    type: 'product',
    priority: 'medium',
    rationale: 'В записи много простых углеводов.',
    draftText:
      'Простые углеводы дают быструю энергию, но быстро уходят. Попробуй заменить часть на цельнозерновые или добавить белок и овощи.',
  },
};

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

function detectCriteria(description: string | null): AnalysisCriterion[] {
  if (!description) return [];
  const lower = description.toLowerCase();
  const found: AnalysisCriterion[] = [];

  for (const [criterion, config] of Object.entries(CRITERIA_CONFIG)) {
    if (config.keywords.some((keyword) => lower.includes(keyword))) {
      found.push(criterion as AnalysisCriterion);
    }
  }

  return found;
}

function invertCriteriaIfNeeded(
  detected: AnalysisCriterion[],
  entry: DiaryAnalysisInput['entry'],
): AnalysisCriterion[] {
  // Если описание короткое и нет ключевых слов, но есть фото — не пытаемся угадать.
  if (entry.hasPhoto && !entry.description) return [];

  // Если ничего не найдено, но описание есть — предполагаем дефицит воды и овощей как мягкое напоминание.
  if (detected.length === 0 && entry.description) {
    return ['water', 'vegetables_fiber_deficit'];
  }

  return detected;
}

export class MockAIEngine implements AIEngine {
  analyzeDiary(input: DiaryAnalysisInput): Promise<DiaryAnalysisResult> {
    const detected = detectCriteria(input.entry.description);
    const criteria = invertCriteriaIfNeeded(detected, input.entry);
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

  generateRecommendationText(proposal: RecommendationProposal): Promise<string> {
    // В mock-режиме просто возвращаем черновик, без обращения к AI.
    return Promise.resolve(proposal.draftText);
  }
}
