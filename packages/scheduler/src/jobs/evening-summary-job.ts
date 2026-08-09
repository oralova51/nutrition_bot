// Ежедневная вечерняя сводка питания (ФТ-24, roadmap 4.20–4.24).
// В 21:00 по TZ клиента анализирует filled-записи дня и отправляет soft summary.
// force=true — для ручного теста: игнорирует 21:00 и дневной дедуп.

import { fromZonedTime, format, toZonedTime } from 'date-fns-tz';
import { Op } from 'sequelize';
import { buildAndSendEveningSummary } from '@nutrition-bot/ai';
import {
  Client,
  ClientEnrollment,
  DEFAULT_TIMEZONE,
  NotificationSettings,
  NutritionDiary,
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

  for (const client of clients) {
    const clientWithAssoc = client as ClientWithAssociations;
    const settings = clientWithAssoc.notificationSettings;
    const enrollment = clientWithAssoc.enrollments?.[0];
    if (!settings || !enrollment) {
      result.skipped += 1;
      continue;
    }

    const timezone = DEFAULT_TIMEZONE;
    const zonedNow = toZonedTime(new Date(), timezone);
    const currentTime = format(zonedNow, 'HH:mm', { timeZone: timezone });
    if (!force && currentTime !== '21:00') {
      result.skipped += 1;
      continue;
    }

    const localDate = format(zonedNow, 'yyyy-MM-dd', { timeZone: timezone });
    const dayRange = getZonedDayRange(new Date(), timezone);

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
    }
  }

  return result;
}

function getZonedDayRange(date: Date, timezone: string): { start: Date; end: Date } {
  const zonedNow = toZonedTime(date, timezone);
  const dateString = format(zonedNow, 'yyyy-MM-dd', { timeZone: timezone });
  const startLocal = new Date(`${dateString}T00:00:00`);
  const endLocal = new Date(`${dateString}T23:59:59.999`);
  return {
    start: fromZonedTime(startLocal, timezone),
    end: fromZonedTime(endLocal, timezone),
  };
}
