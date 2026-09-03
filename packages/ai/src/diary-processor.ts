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
  getZonedDayRange,
  logAiEngineError,
  notifyAdminJobFailure,
  sendTelegramMessage,
} from '@nutrition-bot/shared';
import { maybeSendEveningSummaryIfDue } from './evening-summary.js';
import { createAIEngine } from './factory.js';
import { logger } from './logger.js';
import { MAX_DAILY_RECOMMENDATIONS, selectProposalsToSend } from './proposal-selection.js';
import type { DiaryAnalysisInput } from './types.js';

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
  const timezone = DEFAULT_TIMEZONE;

  let recommendationsCreated = 0;
  let messagesSent = 0;
  let skippedDueToLimit = 0;

  if (availableSlots > 0) {
    try {
      const history = await loadHistoryForEnrollment(entry.clientEnrollmentId);
      const previousHistory = await loadPreviousEnrollmentHistory(
        client.id,
        entry.clientEnrollmentId,
      );
      const questionnaire = await loadQuestionnaireForEnrollment(entry.clientEnrollmentId);

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
      const proposalsToSend = selectProposalsToSend(analysis.proposals, availableSlots);
      skippedDueToLimit = Math.max(0, analysis.proposals.length - proposalsToSend.length);

      for (const proposal of proposalsToSend) {
        const text = await engine.generateRecommendationText(proposal, input.clientContext);
        const recommendation = await Recommendation.create({
          clientId: client.id,
          nutritionDiaryId: entry.id,
          questionnaireId: null,
          type: proposal.type,
          priority: proposal.priority,
          content: text,
          // 'sent' здесь = «выпущена»: других статусов схема не допускает, а факт
          // доставки хранится в Message.deliveryStatus.
          status: 'sent',
        });

        recommendationsCreated += 1;

        // Быстрая обратная связь: отправляем сразу после подтверждения дневника.
        // Вечерний job (roadmap 5.8) пропускает уже отправленные через hasRecommendationMessage.
        // Сбой доставки не прерывает обработку: остальные предложения и вечерняя сводка
        // не должны зависеть от одного недоступного чата, а недоставленное подберёт job в 20:00.
        try {
          await sendRecommendationMessage(client.telegramId, client.id, recommendation.id, text);
          messagesSent += 1;
        } catch (err) {
          logger.warn(
            { err, clientId: client.id, recommendationId: recommendation.id },
            'Рекомендация создана, но не доставлена в Telegram',
          );
        }
      }
    } catch (err) {
      logAiEngineError(logger, { clientId: client.id, nutritionDiaryId, err });
      await notifyAdminJobFailure({
        kind: 'recommendation',
        clientId: client.id,
        entryId: nutritionDiaryId,
        err,
      });
      throw err;
    }
  }

  // Если клиент записал еду уже после 21:00, сводка иначе пропустит день.
  try {
    const evening = await maybeSendEveningSummaryIfDue({
      client,
      enrollmentId: enrollment.id,
      timezone,
    });
    if (evening.usedProviderFallback) {
      await notifyAdminJobFailure({
        kind: 'evening_summary',
        clientId: client.id,
        entryId: nutritionDiaryId,
        err: evening.providerError,
        usedFallback: true,
      });
    }
  } catch (err) {
    logger.error(
      { err, clientId: client.id, entryId: nutritionDiaryId },
      'Не удалось отправить вечернюю сводку после записи дневника',
    );
    await notifyAdminJobFailure({
      kind: 'evening_summary',
      clientId: client.id,
      entryId: nutritionDiaryId,
      err,
    });
  }

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
  // Лимит 2–3/день — по факту доставленных в Telegram: строка Message создаётся
  // до отправки, и без фильтра по deliveryStatus сбой доставки сжигал бы слот,
  // блокируя обратную связь до конца суток.
  const { start, end } = getZonedDayRange(new Date(), DEFAULT_TIMEZONE);

  return Message.count({
    where: {
      clientId,
      type: 'recommendation',
      deliveryStatus: 'sent',
      createdAt: { [Op.between]: [start, end] },
    },
  });
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
