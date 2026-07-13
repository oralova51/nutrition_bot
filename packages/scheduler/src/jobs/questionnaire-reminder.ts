// Напоминание о брошенной анкете (roadmap 3.14, отложено до 4.1).
// Если клиент не отвечал на вопросы более N минут — отправляем мягкое напоминание.

import { subMinutes } from 'date-fns';
import { Op } from 'sequelize';
import {
  Client,
  ClientEnrollment,
  Questionnaire,
  sendTelegramMessageWithRetry,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';

interface QuestionnaireWithAssociations extends Questionnaire {
  client?: Client;
  enrollment?: ClientEnrollment;
}

// Для теста зафиксировано 2 минуты (roadmap 3.14).
const INACTIVITY_MINUTES = 2;

export async function runQuestionnaireReminderJob(logger: Logger): Promise<void> {
  const now = new Date();
  const inactivityThreshold = subMinutes(now, INACTIVITY_MINUTES);

  const questionnaires = await Questionnaire.findAll({
    include: [
      {
        model: ClientEnrollment,
        as: 'enrollment',
        required: true,
        where: {
          status: 'active',
          onboardingStatus: 'in_progress',
        },
      },
      {
        model: Client,
        as: 'client',
        required: true,
        where: {
          telegramId: { [Op.ne]: null },
        },
      },
    ],
    where: {
      status: 'in_progress',
      [Op.or]: [{ lastAnswerAt: null }, { lastAnswerAt: { [Op.lt]: inactivityThreshold } }],
      // Не отправляем повторно, пока не будет нового ответа.
      lastReminderAt: null,
    },
  });

  logger.info({ count: questionnaires.length }, 'Выборка анкет для напоминания о брошенной анкете');

  for (const questionnaire of questionnaires) {
    const questionnaireWithAssoc = questionnaire as QuestionnaireWithAssociations;
    const client = questionnaireWithAssoc.client;
    const enrollment = questionnaireWithAssoc.enrollment;
    if (!client?.telegramId || !enrollment) continue;

    const questionNumber = questionnaire.currentQuestion + 1;
    const text = `Вы остановились на вопросе ${questionNumber}. Давайте продолжим — это займёт совсем немного времени.`;

    try {
      await sendTelegramMessageWithRetry({
        telegramId: client.telegramId,
        text,
        clientId: client.id,
        type: 'questionnaire_reminder',
        category: 'optional',
      });
      await questionnaire.update({ lastReminderAt: now });
      logger.info(
        { clientId: client.id, questionnaireId: questionnaire.id, questionNumber },
        'Напоминание о брошенной анкете отправлено',
      );
    } catch (err) {
      logger.error(
        { clientId: client.id, questionnaireId: questionnaire.id, err },
        'Не удалось отправить напоминание о брошенной анкете',
      );
    }
  }
}
