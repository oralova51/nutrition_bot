/**
 * Сервис асинхронной обработки записи дневника.
 * Roadmap 5.2: очередь асинхронной обработки после сохранения дневника.
 * Roadmap 5.3: анализ по 6 критериям.
 * Roadmap 5.4: сравнение с историей за enrollment.
 * Roadmap 5.6: лимит 2–3 рекомендации в день.
 * Roadmap 5.7: немедленная отправка при priority=critical.
 * Roadmap 5.8: отложенная отправка (конец дня) для medium/low.
 * Roadmap 5.9: генерация текста в мягком тоне.
 * Roadmap 5.10: отправка в Telegram + сохранение Message.
 */

import { Op } from 'sequelize';
import {
  Client,
  ClientEnrollment,
  NutritionDiary,
  Questionnaire,
  Recommendation,
  sendTelegramMessage,
  type Message,
} from '@nutrition-bot/shared';
import { createAIEngine } from './factory.js';
import { logger } from './logger.js';
import type { DiaryAnalysisInput } from './types.js';

const MAX_DAILY_RECOMMENDATIONS = 3;

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
  const questionnaire = await loadQuestionnaireForEnrollment(entry.clientEnrollmentId);
  const timezone = await resolveClientTimezone(client.id);

  const input: DiaryAnalysisInput = {
    entry,
    history,
    questionnaire,
    clientContext: {
      firstName: client.firstName ?? null,
      timezone,
    },
  };

  const engine = createAIEngine();
  const analysis = await engine.analyzeDiary(input);

  let recommendationsCreated = 0;
  let messagesSent = 0;
  let skippedDueToLimit = 0;

  for (const proposal of analysis.proposals) {
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

    if (proposal.priority === 'critical') {
      await sendRecommendationMessage(client.telegramId, client.id, recommendation.id, text);
      messagesSent += 1;
    }
    // medium/low: Recommendation создана, но Message отправляется вечерним job (roadmap 5.8).
  }

  skippedDueToLimit += Math.max(0, analysis.proposals.length - recommendationsCreated - skippedDueToLimit);

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

async function loadQuestionnaireForEnrollment(clientEnrollmentId: string): Promise<Questionnaire | null> {
  return Questionnaire.findOne({
    where: { clientEnrollmentId, status: 'completed' },
    order: [['completedAt', 'DESC']],
  });
}

async function countRecommendationsToday(clientId: string): Promise<number> {
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));

  return Recommendation.count({
    where: {
      clientId,
      createdAt: { [Op.between]: [startOfDay, endOfDay] },
    },
  });
}

async function resolveClientTimezone(clientId: string): Promise<string> {
  const settings = await import('@nutrition-bot/shared').then((m) =>
    m.NotificationSettings.findOne({ where: { clientId } }),
  );
  return settings?.timezone ?? 'Europe/Moscow';
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
