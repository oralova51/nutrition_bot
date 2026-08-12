/**
 * Сервис асинхронной обработки записи дневника.
 * Roadmap 5.2: очередь асинхронной обработки после сохранения дневника.
 * Roadmap 5.3: анализ по 6 критериям.
 * Roadmap 5.4: сравнение с историей за enrollment.
 * Roadmap 5.6: лимит 2–3 рекомендации в день.
 * Roadmap 5.7–5.8 / UX: после записи дневника отправляем рекомендации сразу
 *   (быстрая обратная связь). Вечерний job остаётся страховкой для недоставленных.
 * Roadmap 5.9: генерация текста в мягком тоне.
 * Roadmap 5.10: отправка в Telegram + сохранение Message.
 */

import { Op } from 'sequelize';
import {
  Client,
  ClientEnrollment,
  DEFAULT_TIMEZONE,
  Message,
  NutritionDiary,
  Questionnaire,
  Recommendation,
  sendTelegramMessage,
} from '@nutrition-bot/shared';
import { createAIEngine } from './factory.js';
import { logger } from './logger.js';
import type {
  DiaryAnalysisInput,
  RecommendationPriority,
  RecommendationProposal,
} from './types.js';

const MAX_DAILY_RECOMMENDATIONS = 3;

const PRIORITY_ORDER: Record<RecommendationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

interface ProcessDiaryResult {
  recommendationsCreated: number;
  messagesSent: number;
  skippedDueToLimit: number;
}

/**
 * Обработать одну запись дневника: проанализировать и создать рекомендации.
 * Асинхронная — не блокирует ответ бота (roadmap 5.2, nonFR §1).
 */
export async function processDiaryEntry(nutritionDiaryId: string): Promise<ProcessDiaryResult> {
  const entry = await NutritionDiary.findByPk(nutritionDiaryId);

  if (!entry) {
    throw new Error(`Запись дневника не найдена: ${nutritionDiaryId}`);
  }

  const [client, enrollment] = await Promise.all([
    Client.findByPk(entry.clientId),
    ClientEnrollment.findByPk(entry.clientEnrollmentId),
  ]);

  if (!client?.telegramId || !enrollment) {
    return { recommendationsCreated: 0, messagesSent: 0, skippedDueToLimit: 0 };
  }

  if (enrollment.status !== 'active') {
    return { recommendationsCreated: 0, messagesSent: 0, skippedDueToLimit: 0 };
  }

  logger.debug({ entryId: nutritionDiaryId, clientId: client.id }, 'Начат анализ дневника');

  const existingCount = await countRecommendationsToday(client.id);
  const availableSlots = Math.max(0, MAX_DAILY_RECOMMENDATIONS - existingCount);

  if (availableSlots === 0) {
    return { recommendationsCreated: 0, messagesSent: 0, skippedDueToLimit: 0 };
  }

  const history = await loadHistoryForEnrollment(entry.clientEnrollmentId);
  const previousHistory = await loadPreviousEnrollmentHistory(client.id, entry.clientEnrollmentId);
  const questionnaire = await loadQuestionnaireForEnrollment(entry.clientEnrollmentId);
  const timezone = DEFAULT_TIMEZONE;

  const input: DiaryAnalysisInput = {
    entry,
    history,
    previousHistory,
    questionnaire,
    clientContext: {
      firstName: client.firstName ?? null,
      timezone,
    },
  };

  const engine = createAIEngine();
  const analysis = await engine.analyzeDiary(input);
  const proposals = sortProposalsByPriority(analysis.proposals);

  let recommendationsCreated = 0;
  let messagesSent = 0;
  let skippedDueToLimit = 0;

  for (const proposal of proposals) {
    if (recommendationsCreated >= availableSlots) {
      skippedDueToLimit += 1;
      continue;
    }

    const text = await engine.generateRecommendationText(proposal, input.clientContext);
    const recommendation = await Recommendation.create({
      clientId: client.id,
      nutritionDiaryId: entry.id,
      questionnaireId: null,
      type: proposal.type,
      priority: proposal.priority,
      content: text,
      status: 'sent',
    });

    recommendationsCreated += 1;

    // Быстрая обратная связь: отправляем сразу после подтверждения дневника.
    // Вечерний job (roadmap 5.8) пропускает уже отправленные через hasRecommendationMessage.
    await sendRecommendationMessage(client.telegramId, client.id, recommendation.id, text);
    messagesSent += 1;
  }

  skippedDueToLimit += Math.max(
    0,
    analysis.proposals.length - recommendationsCreated - skippedDueToLimit,
  );

  logger.info(
    {
      entryId: nutritionDiaryId,
      clientId: client.id,
      recommendationsCreated,
      messagesSent,
      skippedDueToLimit,
    },
    'Анализ дневника завершён',
  );

  return { recommendationsCreated, messagesSent, skippedDueToLimit };
}

async function loadHistoryForEnrollment(clientEnrollmentId: string): Promise<NutritionDiary[]> {
  return NutritionDiary.findAll({
    where: { clientEnrollmentId },
    order: [['mealAt', 'DESC']],
  });
}

async function loadPreviousEnrollmentHistory(
  clientId: string,
  currentEnrollmentId: string,
): Promise<NutritionDiary[]> {
  const previousEnrollment = await ClientEnrollment.findOne({
    where: {
      clientId,
      id: { [Op.ne]: currentEnrollmentId },
      status: 'completed',
    },
    order: [['endDate', 'DESC']],
  });

  if (!previousEnrollment) {
    return [];
  }

  return NutritionDiary.findAll({
    where: { clientEnrollmentId: previousEnrollment.id },
    order: [['mealAt', 'DESC']],
    limit: 50,
  });
}

async function loadQuestionnaireForEnrollment(
  clientEnrollmentId: string,
): Promise<Questionnaire | null> {
  return Questionnaire.findOne({
    where: { clientEnrollmentId, status: 'completed' },
    order: [['completedAt', 'DESC']],
  });
}

async function countRecommendationsToday(clientId: string): Promise<number> {
  // Лимит 2–3/день — по факту доставленных в Telegram, а не по «висящим» строкам в БД.
  // Иначе сбой отправки блокирует обратную связь до конца суток.
  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
  );
  const endOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0),
  );

  return Message.count({
    where: {
      clientId,
      type: 'recommendation',
      createdAt: { [Op.between]: [startOfDay, endOfDay] },
    },
  });
}

function sortProposalsByPriority(proposals: RecommendationProposal[]): RecommendationProposal[] {
  return [...proposals].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

async function sendRecommendationMessage(
  telegramId: string,
  clientId: string,
  recommendationId: string,
  text: string,
): Promise<Message> {
  const result = await sendTelegramMessage({
    telegramId,
    text,
    clientId,
    type: 'recommendation',
    category: 'optional',
  });

  await result.message.update({ recommendationId });
  return result.message;
}
