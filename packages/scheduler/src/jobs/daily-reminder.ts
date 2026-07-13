// Ежедневное напоминание о дневнике питания (roadmap 4.2–4.7).
// Выбирает активных клиентов, у которых текущее локальное время совпадает с reminderTime
// и частота разрешает отправку сегодня.

import { differenceInCalendarDays, parseISO } from 'date-fns';
import { format, toZonedTime } from 'date-fns-tz';
import { Op } from 'sequelize';
import {
  Client,
  ClientEnrollment,
  NotificationSettings,
  sendTelegramMessageWithRetry,
  type NotificationFrequency,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';

interface ClientWithAssociations extends Client {
  notificationSettings?: NotificationSettings;
  enrollments?: ClientEnrollment[];
}

const DAILY_REMINDER_TEXT =
  'Чем ты сегодня завтракал? 🍳\n\nЗапиши в дневник — это поможет мне лучше понять твои привычки.';

export async function runDailyReminderJob(logger: Logger): Promise<void> {
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
    where: {
      telegramId: { [Op.ne]: null },
    },
  });

  logger.info({ count: clients.length }, 'Выборка клиентов для ежедневного напоминания');

  for (const client of clients) {
    const clientWithAssoc = client as ClientWithAssociations;
    const settings = clientWithAssoc.notificationSettings;
    const enrollment = clientWithAssoc.enrollments?.[0];
    if (!settings || !enrollment) continue;

    const timezone = settings.timezone;
    const zonedNow = toZonedTime(new Date(), timezone);
    const currentTime = format(zonedNow, 'HH:mm', { timeZone: timezone });

    if (currentTime !== settings.reminderTime) {
      continue;
    }

    if (!shouldSendToday(settings.frequency, zonedNow, timezone, enrollment)) {
      continue;
    }

    try {
      await sendTelegramMessageWithRetry({
        telegramId: client.telegramId!,
        text: DAILY_REMINDER_TEXT,
        clientId: client.id,
        type: 'reminder',
        category: 'optional',
      });
      logger.info(
        { clientId: client.id, time: currentTime, timezone },
        'Ежедневное напоминание отправлено',
      );
    } catch (err) {
      logger.error({ clientId: client.id, err }, 'Не удалось отправить ежедневное напоминание');
    }
  }
}

function shouldSendToday(
  frequency: NotificationFrequency,
  zonedNow: Date,
  timezone: string,
  enrollment: ClientEnrollment,
): boolean {
  switch (frequency) {
    case 'daily':
      return true;
    case 'every_other_day':
      return isEveryOtherDay(zonedNow, timezone, enrollment);
    case 'three_per_week':
      return isThreePerWeekDay(zonedNow, timezone);
    case 'custom_days':
      // Post-MVP: требует отдельного поля custom_days в NotificationSettings.
      return false;
    default:
      return false;
  }
}

function isEveryOtherDay(zonedNow: Date, timezone: string, enrollment: ClientEnrollment): boolean {
  const startDate = enrollment.startDate;
  if (!startDate) return false;

  const start = parseISO(startDate);
  const zonedStart = toZonedTime(start, timezone);
  const daysDiff = differenceInCalendarDays(
    startOfZonedDay(zonedNow, timezone),
    startOfZonedDay(zonedStart, timezone),
  );
  return daysDiff % 2 === 0;
}

function isThreePerWeekDay(zonedNow: Date, timezone: string): boolean {
  // MVP: фиксированные дни — понедельник, среда, пятница (ISO 1, 3, 5).
  const isoDayOfWeek = Number(format(zonedNow, 'i', { timeZone: timezone }));
  return [1, 3, 5].includes(isoDayOfWeek);
}

function startOfZonedDay(date: Date, timezone: string): Date {
  const dateString = format(date, 'yyyy-MM-dd', { timeZone: timezone });
  return parseISO(`${dateString}T00:00:00`);
}
