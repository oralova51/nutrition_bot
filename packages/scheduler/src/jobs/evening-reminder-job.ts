// Вечернее напоминание о незаполненном дневнике (roadmap 4.16–4.19).
// Запускается каждые 30 минут, проверяет локальное время 20:00 и количество
// записей NutritionDiary за день. Если записей < 3 — отправляет мягкое напоминание.
// force=true — для ручного теста: игнорирует время, лимит дневника и дедуп за день.

import { Op } from 'sequelize';
import {
  Client,
  ClientEnrollment,
  DEFAULT_TIMEZONE,
  Message,
  NotificationSettings,
  NutritionDiary,
  formatZonedTime,
  getZonedDayRange,
  sendTelegramMessageWithRetry,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';
import type { SchedulerJobOptions, SchedulerJobResult } from './types.js';

const REMINDER_TIME = '20:00';

const EVENING_REMINDER_TEXT =
  'Мне кажется, я не услышал о твоём ужине. Если ты что-нибудь ел, поделись со мной?';

interface ClientWithAssociations extends Client {
  notificationSettings?: NotificationSettings;
  enrollments?: ClientEnrollment[];
}

export async function runEveningReminderJob(
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
    'Выборка клиентов для вечернего напоминания',
  );

  const result: SchedulerJobResult = {
    job: 'evening-reminder',
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
    if (!force && formatZonedTime(now, timezone) !== REMINDER_TIME) {
      result.skipped += 1;
      continue;
    }

    const { start, end } = getZonedDayRange(now, timezone);
    if (!force) {
      const diaryCount = await NutritionDiary.count({
        where: {
          clientEnrollmentId: enrollment.id,
          mealAt: { [Op.between]: [start, end] },
        },
      });

      if (diaryCount >= 3) {
        result.skipped += 1;
        continue;
      }

      const alreadySent = await hasEveningReminderToday(client.id, start, end);
      if (alreadySent) {
        result.skipped += 1;
        continue;
      }
    }

    try {
      await sendTelegramMessageWithRetry({
        telegramId: client.telegramId!,
        text: EVENING_REMINDER_TEXT,
        clientId: client.id,
        type: 'evening_reminder',
        category: 'optional',
      });
      result.sent += 1;
      logger.info({ clientId: client.id, timezone, force }, 'Вечернее напоминание отправлено');
    } catch (err) {
      result.errors += 1;
      logger.error({ clientId: client.id, err }, 'Не удалось отправить вечернее напоминание');
    }
  }

  return result;
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
