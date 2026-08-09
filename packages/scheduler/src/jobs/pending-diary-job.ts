// Ночной job: создание NutritionDiary со статусом pending,
// если клиент не прислал данные о питании за вчерашний день (roadmap 4.14).
// Запускается в 00:30 UTC — это после полуночи для всех российских часовых поясов.

import { parseISO, subDays } from 'date-fns';
import { fromZonedTime, format, toZonedTime } from 'date-fns-tz';
import { Op } from 'sequelize';
import {
  Client,
  ClientEnrollment,
  DEFAULT_TIMEZONE,
  NotificationSettings,
  NutritionDiary,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';

interface ClientWithAssociations extends Client {
  notificationSettings?: NotificationSettings;
  enrollments?: ClientEnrollment[];
}

export async function runPendingDiaryJob(logger: Logger): Promise<void> {
  const clients = await Client.findAll({
    include: [
      {
        model: NotificationSettings,
        as: 'notificationSettings',
        required: false,
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

  logger.info({ count: clients.length }, 'Выборка клиентов для проверки pending-записей дневника');

  for (const client of clients) {
    const clientWithAssoc = client as ClientWithAssociations;
    const enrollment = clientWithAssoc.enrollments?.[0];
    if (!enrollment) continue;

    const timezone = DEFAULT_TIMEZONE;
    const { start, end, dateString } = getYesterdayZonedDayRange(new Date(), timezone);

    const existingCount = await NutritionDiary.count({
      where: {
        clientEnrollmentId: enrollment.id,
        mealAt: { [Op.between]: [start, end] },
      },
    });

    if (existingCount > 0) {
      continue;
    }

    try {
      await NutritionDiary.create({
        clientEnrollmentId: enrollment.id,
        clientId: client.id,
        mealAt: end,
        description: null,
        approxCalories: null,
        hasPhoto: false,
        photoRef: null,
        status: 'pending',
      });
      logger.info(
        { clientId: client.id, enrollmentId: enrollment.id, date: dateString },
        'Создана pending-запись дневника за день без данных',
      );
    } catch (err) {
      logger.error(
        { clientId: client.id, enrollmentId: enrollment.id, err },
        'Не удалось создать pending-запись дневника',
      );
    }
  }
}

function getYesterdayZonedDayRange(
  date: Date,
  timezone: string,
): { start: Date; end: Date; dateString: string } {
  const zonedNow = toZonedTime(date, timezone);
  const todayString = format(zonedNow, 'yyyy-MM-dd', { timeZone: timezone });
  const yesterday = subDays(parseISO(`${todayString}T00:00:00`), 1);
  const dateString = format(yesterday, 'yyyy-MM-dd');

  const startLocal = new Date(`${dateString}T00:00:00`);
  const endLocal = new Date(`${dateString}T23:59:59.999`);

  return {
    start: fromZonedTime(startLocal, timezone),
    end: fromZonedTime(endLocal, timezone),
    dateString,
  };
}
