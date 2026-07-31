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
  | 'simple_carbs_excess';

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

export interface AIEngine {
  /** Проанализировать запись дневника и предложить рекомендации. */
  analyzeDiary(input: DiaryAnalysisInput): Promise<DiaryAnalysisResult>;

  /** Сгенерировать финальный текст рекомендации в мягком тоне. */
  generateRecommendationText(
    proposal: RecommendationProposal,
    context: ClientContext,
  ): Promise<string>;
}
