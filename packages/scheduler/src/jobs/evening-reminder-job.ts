// Вечернее напоминание о незаполненном дневнике (roadmap 4.16–4.19).
// Запускается каждые 30 минут, проверяет локальное время 20:00 и количество
// записей NutritionDiary за день. Если записей < 3 — отправляет мягкое напоминание.

import { fromZonedTime, format, toZonedTime } from 'date-fns-tz';
import { Op } from 'sequelize';
import {
  Client,
  ClientEnrollment,
  DEFAULT_TIMEZONE,
  Message,
  NotificationSettings,
  NutritionDiary,
  sendTelegramMessageWithRetry,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';

const EVENING_REMINDER_TEXT =
  'Мне кажется, я не услышал о твоём ужине. Если ты что-нибудь ел, поделись со мной?';

interface ClientWithAssociations extends Client {
  notificationSettings?: NotificationSettings;
  enrollments?: ClientEnrollment[];
}

export async function runEveningReminderJob(logger: Logger): Promise<void> {
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

  logger.info({ count: clients.length }, 'Выборка клиентов для вечернего напоминания');

  for (const client of clients) {
    const clientWithAssoc = client as ClientWithAssociations;
    const settings = clientWithAssoc.notificationSettings;
    const enrollment = clientWithAssoc.enrollments?.[0];
    if (!settings || !enrollment) continue;

    const timezone = DEFAULT_TIMEZONE;
    const zonedNow = toZonedTime(new Date(), timezone);
    const currentTime = format(zonedNow, 'HH:mm', { timeZone: timezone });
    if (currentTime !== '20:00') {
      continue;
    }

    const { start, end } = getZonedDayRange(new Date(), timezone);
    const diaryCount = await NutritionDiary.count({
      where: {
        clientEnrollmentId: enrollment.id,
        mealAt: { [Op.between]: [start, end] },
      },
    });

    if (diaryCount >= 3) {
      continue;
    }

    const alreadySent = await hasEveningReminderToday(client.id, start, end);
    if (alreadySent) {
      continue;
    }

    try {
      await sendTelegramMessageWithRetry({
        telegramId: client.telegramId!,
        text: EVENING_REMINDER_TEXT,
        clientId: client.id,
        type: 'evening_reminder',
        category: 'optional',
      });
      logger.info({ clientId: client.id, diaryCount, timezone }, 'Вечернее напоминание отправлено');
    } catch (err) {
      logger.error({ clientId: client.id, err }, 'Не удалось отправить вечернее напоминание');
    }
  }
}

async function hasEveningReminderToday(clientId: string, start: Date, end: Date): Promise<boolean> {
  const count = await Message.count({
    where: {
      clientId,
      type: 'evening_reminder',
      createdAt: { [Op.between]: [start, end] },
    },
  });
  return count > 0;
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
