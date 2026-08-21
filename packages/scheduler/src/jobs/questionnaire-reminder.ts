// Напоминание о брошенной анкете (roadmap 3.14, ФТ-2).
// Если клиент не отвечает дольше N часов — одно мягкое напоминание; после него
// таймер запускается заново (anketa.md: рекомендуемый старт 24 ч).

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

/** SA/anketa.md: 24 часа. Для локальной отладки — QUESTIONNAIRE_REMINDER_INACTIVITY_MINUTES. */
const DEFAULT_INACTIVITY_MINUTES = 24 * 60;

export function resolveQuestionnaireReminderInactivityMinutes(override?: number): number {
  if (override !== undefined && Number.isInteger(override) && override > 0) {
    return override;
  }

  const raw = process.env.QUESTIONNAIRE_REMINDER_INACTIVITY_MINUTES;
  if (!raw) {
    return DEFAULT_INACTIVITY_MINUTES;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_INACTIVITY_MINUTES;
  }

  return parsed;
}

export async function runQuestionnaireReminderJob(
  logger: Logger,
  options?: { inactivityMinutes?: number },
): Promise<void> {
  const now = new Date();
  const inactivityMinutes = resolveQuestionnaireReminderInactivityMinutes(
    options?.inactivityMinutes,
  );
  const inactivityThreshold = subMinutes(now, inactivityMinutes);

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
      [Op.and]: [
        { [Op.or]: [{ lastAnswerAt: null }, { lastAnswerAt: { [Op.lt]: inactivityThreshold } }] },
        {
          [Op.or]: [{ lastReminderAt: null }, { lastReminderAt: { [Op.lt]: inactivityThreshold } }],
        },
      ],
    },
  });

  logger.info({ count: questionnaires.length }, 'Выборка анкет для напоминания о брошенной анкете');

  for (const questionnaire of questionnaires) {
    const questionnaireWithAssoc = questionnaire as QuestionnaireWithAssociations;
    const client = questionnaireWithAssoc.client;
    const enrollment = questionnaireWithAssoc.enrollment;
    if (!client?.telegramId || !enrollment) continue;

    const alreadyOnboarded = await ClientEnrollment.findOne({
      where: {
        clientId: client.id,
        id: { [Op.ne]: enrollment.id },
        status: { [Op.in]: ['active', 'paused'] },
        onboardingStatus: 'completed',
      },
    });
    if (alreadyOnboarded) {
      logger.info(
        { clientId: client.id, questionnaireId: questionnaire.id },
        'Пропуск напоминания: у клиента уже есть пройденный онбординг',
      );
      continue;
    }

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
