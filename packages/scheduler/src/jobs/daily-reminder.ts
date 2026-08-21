// Ежедневное напоминание о дневнике питания (roadmap 4.2–4.7).
// Выбирает активных клиентов, у которых текущее локальное время совпадает с reminderTime
// и частота разрешает отправку сегодня.
// force=true — для ручного теста: игнорирует время и частоту.

import { differenceInCalendarDays, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Op } from 'sequelize';
import {
  Client,
  ClientEnrollment,
  DEFAULT_TIMEZONE,
  NotificationSettings,
  formatZonedDate,
  formatZonedTime,
  sendTelegramMessageWithRetry,
  type NotificationFrequency,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';
import type { SchedulerJobOptions, SchedulerJobResult } from './types.js';

interface ClientWithAssociations extends Client {
  notificationSettings?: NotificationSettings;
  enrollments?: ClientEnrollment[];
}

const DAILY_REMINDER_TEXT =
  'Чем ты сегодня завтракал? 🍳\n\nЗапиши в дневник — это поможет мне лучше понять твои привычки.';

export async function runDailyReminderJob(
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
          enabledTypes: { [Op.contains]: ['diary'] },
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
    'Выборка клиентов для ежедневного напоминания',
  );

  const result: SchedulerJobResult = {
    job: 'daily-reminder',
    force,
    considered: clients.length,
    sent: 0,
    skipped: 0,
    errors: 0,
  };

  const now = new Date();

  for (const client of clients) {
    const clientWithAssoc = client as ClientWithAssociations;
    const settings = clientWithAssoc.notificationSettings;
    const enrollment = clientWithAssoc.enrollments?.[0];
    if (!settings || !enrollment) {
      result.skipped += 1;
      continue;
    }

    const timezone = DEFAULT_TIMEZONE;
    const currentTime = formatZonedTime(now, timezone);

    if (!force) {
      if (currentTime !== settings.reminderTime) {
        result.skipped += 1;
        continue;
      }

      if (!shouldSendToday(settings.frequency, now, timezone, enrollment)) {
        result.skipped += 1;
        continue;
      }
    }

    try {
      await sendTelegramMessageWithRetry({
        telegramId: client.telegramId!,
        text: DAILY_REMINDER_TEXT,
        clientId: client.id,
        type: 'reminder',
        category: 'optional',
      });
      result.sent += 1;
      logger.info(
        { clientId: client.id, time: currentTime, timezone, force },
        'Ежедневное напоминание отправлено',
      );
    } catch (err) {
      result.errors += 1;
      logger.error({ clientId: client.id, err }, 'Не удалось отправить ежедневное напоминание');
    }
  }

  return result;
}

function shouldSendToday(
  frequency: NotificationFrequency,
  now: Date,
  timezone: string,
  enrollment: ClientEnrollment,
): boolean {
  switch (frequency) {
    case 'daily':
      return true;
    case 'every_other_day':
      return isEveryOtherDay(now, timezone, enrollment);
    case 'three_per_week':
      return isThreePerWeekDay(now, timezone);
    case 'custom_days':
      // Post-MVP: требует отдельного поля custom_days в NotificationSettings.
      return false;
    default:
      return false;
  }
}

function isEveryOtherDay(now: Date, timezone: string, enrollment: ClientEnrollment): boolean {
  const startDate = enrollment.startDate;
  if (!startDate) return false;

  // Обе даты приводим к календарному дню (yyyy-MM-dd) и только потом считаем разницу:
  // паритет должен зависеть от пояса клиента, а не от пояса процесса.
  const daysDiff = differenceInCalendarDays(
    parseISO(formatZonedDate(now, timezone)),
    parseISO(startDate),
  );
  return daysDiff >= 0 && daysDiff % 2 === 0;
}

function isThreePerWeekDay(now: Date, timezone: string): boolean {
  // MVP: фиксированные дни — понедельник, среда, пятница (ISO 1, 3, 5).
  const isoDayOfWeek = Number(formatInTimeZone(now, timezone, 'i'));
  return [1, 3, 5].includes(isoDayOfWeek);
}
