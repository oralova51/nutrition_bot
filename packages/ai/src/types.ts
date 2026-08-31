/**
 * Публичные типы AI Engine.
 * Описывают входные данные для анализа дневника и результат анализа.
 */

import type { NutritionDiary, Questionnaire } from '@nutrition-bot/shared';

export type AnalysisCriterion =
  | 'water'
  | 'sugar_fat_excess'
  | 'protein_deficit'
  | 'snacking_overeating'
  | 'vegetables_fiber_deficit'
  | 'simple_carbs_excess'
  | 'treat_frequency';

export type RecommendationType = 'product' | 'habit' | 'regimen' | 'calories';

export type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low';

export interface ClientContext {
  firstName: string | null;
  timezone: string;
  /** Цель клиента, если известна (пока не обязательно). */
  goalDescription?: string;
}

export interface DiaryAnalysisInput {
  /** Текущая запись дневника, которую нужно проанализировать. */
  entry: NutritionDiary;
  /** История записей за текущий enrollment (включая текущую). */
  history: NutritionDiary[];
  /** История записей за предыдущий завершённый enrollment (roadmap 8.5). */
  previousHistory?: NutritionDiary[];
  /** Анкета клиента, если заполнена. */
  questionnaire?: Questionnaire | null;
  /** Контекст клиента для персонализации текста. */
  clientContext: ClientContext;
}

export interface RecommendationProposal {
  id: string;
  criterion: AnalysisCriterion;
  type: RecommendationType;
  priority: RecommendationPriority;
  /** Краткое обоснование, почему выявлена проблема. */
  rationale: string;
  /** Черновик текста рекомендации (может быть переписан AI). */
  draftText: string;
}

export interface DiaryAnalysisResult {
  proposals: RecommendationProposal[];
  /** Служебная информация: использованная модель, токены, длительность и т.д. */
  metadata: Record<string, unknown>;
}

export interface EveningSummaryInput {
  /** Заполненные записи дневника за день. */
  dayEntries: NutritionDiary[];
  /** Контекст клиента для персонализации текста. */
  clientContext: ClientContext;
  /** Дата дня в формате YYYY-MM-DD (локальная дата клиента). */
  localDate: string;
}

export interface EveningSummaryResult {
  enough: string[];
  missing: string[];
  toAdd: string[];
  improvements: string[];
  /** Готовый текст сообщения для Telegram (HTML допустим). */
  summaryText: string;
  metadata: Record<string, unknown>;
}

export type ClarityMissingField = 'product' | 'quantity' | 'time' | 'calories';

export interface ClarityCheckInput {
  /** Текстовое описание записи дневника, которое нужно оценить. */
  description: string;
  /** К записи приложено фото (OCR/vision пока не используется). */
  hasPhoto?: boolean;
  /** Указанная клиентом приблизительная калорийность. */
  approxCalories?: number | null;
  /** Контекст клиента для персонализации вопроса. */
  clientContext: ClientContext;
}

export interface ClarityCheckResult {
  /** Нужно ли уточнять запись перед анализом. */
  needsClarification: boolean;
  /** Каких полей не хватает: product | quantity | time | calories. */
  missingFields: ClarityMissingField[];
  /** Мягкий уточняющий вопрос на русском языке; null, если уточнение не нужно. */
  question: string | null;
}

export interface TopProductsInput {
  /** Заполненные записи дневника за период отчёта. */
  entries: NutritionDiary[];
  /** Сколько продуктов вернуть (по умолчанию 5). */
  limit?: number;
}

export interface TopProductsResult {
  topProducts: string[];
  metadata: Record<string, unknown>;
}

export interface AIEngine {
  /** Проанализировать запись дневника и предложить рекомендации. */
  analyzeDiary(input: DiaryAnalysisInput): Promise<DiaryAnalysisResult>;

  /** Сгенерировать финальный текст рекомендации в мягком тоне. */
  generateRecommendationText(
    proposal: RecommendationProposal,
    context: ClientContext,
  ): Promise<string>;

  /** Сгенерировать ежедневную вечернюю сводку по всем записям дня (ФТ-24). */
  generateEveningSummary(input: EveningSummaryInput): Promise<EveningSummaryResult>;

  /**
   * Проверить, достаточно ли в записи дневника информации для анализа (ФТ-22).
   * Возвращает структурированный ответ: нужно ли уточнение, чего не хватает
   * и какой мягкий вопрос задать клиенту.
   */
  checkDiaryClarity(input: ClarityCheckInput): Promise<ClarityCheckResult>;

  /**
   * Собрать топ часто встречаемых продуктов/напитков за период (ФТ-14).
   * Вода в топ не входит; остальные напитки (чай, кофе, сок и т.п.) — входят.
   */
  extractTopProducts(input: TopProductsInput): Promise<TopProductsResult>;
}
