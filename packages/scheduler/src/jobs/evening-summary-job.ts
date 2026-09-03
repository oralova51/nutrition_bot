// Ежедневная вечерняя сводка питания (ФТ-24, roadmap 4.20–4.24).
// В 21:00 по TZ клиента анализирует filled-записи дня и отправляет soft summary.
// force=true — для ручного теста: игнорирует 21:00 и дневной дедуп.

import { Op } from 'sequelize';
import { buildAndSendEveningSummary } from '@nutrition-bot/ai';
import {
  Client,
  ClientEnrollment,
  DEFAULT_TIMEZONE,
  NotificationSettings,
  NutritionDiary,
  formatZonedDate,
  formatZonedTime,
  getZonedDayRange,
  isLocalTimeOnOrAfter,
  notifyAdminJobFailuresDigest,
  type JobFailureIssue,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';
import type { SchedulerJobOptions, SchedulerJobResult } from './types.js';

interface ClientWithAssociations extends Client {
  notificationSettings?: NotificationSettings;
  enrollments?: ClientEnrollment[];
}

export async function runEveningSummaryJob(
  logger: Logger,
  options: SchedulerJobOptions = {},
): Promise<SchedulerJobResult> {
  const force = options.force === true;
  const where: Record<string, unknown> = {
    telegramId: { [Op.ne]: null },
  };
  if (options.clientId) {
    where.id = options.clientId;
  }

  const clients = await Client.findAll({
    include: [
      {
        model: NotificationSettings,
        as: 'notificationSettings',
        required: true,
        where: {
          enabled: true,
          enabledTypes: { [Op.contains]: ['evening_summary'] },
        },
      },
      {
        model: ClientEnrollment,
        as: 'enrollments',
        required: true,
        where: {
          status: 'active',
          onboardingStatus: 'completed',
        },
      },
    ],
    where,
  });

  logger.info(
    { count: clients.length, force, clientId: options.clientId ?? null },
    'Выборка клиентов для вечерней сводки',
  );

  const result: SchedulerJobResult = {
    job: 'evening-summary',
    force,
    considered: clients.length,
    sent: 0,
    skipped: 0,
    errors: 0,
  };
  const issues: JobFailureIssue[] = [];

  for (const client of clients) {
    const clientWithAssoc = client as ClientWithAssociations;
    const settings = clientWithAssoc.notificationSettings;
    const enrollment = clientWithAssoc.enrollments?.[0];
    if (!settings || !enrollment) {
      result.skipped += 1;
      continue;
    }

    const timezone = DEFAULT_TIMEZONE;
    if (!force && !isLocalTimeOnOrAfter(new Date(), timezone, '21:00')) {
      result.skipped += 1;
      logger.debug(
        { clientId: client.id, localTime: formatZonedTime(new Date(), timezone) },
        'Вечерняя сводка: слот 21:00 ещё не наступил',
      );
      continue;
    }

    const now = new Date();
    const localDate = formatZonedDate(now, timezone);
    const dayRange = getZonedDayRange(now, timezone);

    try {
      const dayEntries = await NutritionDiary.findAll({
        where: {
          clientEnrollmentId: enrollment.id,
          status: 'filled',
          mealAt: { [Op.between]: [dayRange.start, dayRange.end] },
        },
        order: [['mealAt', 'ASC']],
      });

      const outcome = await buildAndSendEveningSummary({
        client,
        enrollmentId: enrollment.id,
        dayEntries,
        localDate,
        timezone,
        dayRange,
        force,
      });

      if (outcome.sent) {
        result.sent += 1;
        if (outcome.usedProviderFallback) {
          issues.push({
            clientId: client.id,
            err: outcome.providerError,
            usedFallback: true,
          });
        }
      } else if (outcome.reason === 'delivery_failed') {
        result.errors += 1;
      } else {
        result.skipped += 1;
        logger.debug(
          { clientId: client.id, reason: outcome.reason ?? 'skipped' },
          'Вечерняя сводка пропущена',
        );
      }
    } catch (err) {
      result.errors += 1;
      logger.error({ clientId: client.id, err }, 'Не удалось отправить вечернюю сводку');
      issues.push({ clientId: client.id, err });
    }
  }

  await notifyAdminJobFailuresDigest('evening_summary', issues);

  return result;
}
