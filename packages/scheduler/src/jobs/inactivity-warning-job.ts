// Предупреждение о неактивности: 48 ч без сообщений → сообщение в 10:00 (roadmap 6.3, ФТ-9).
//
// Бизнес-правила:
// - Отправляется только клиентам с активным enrollment и включёнными уведомлениями.
// - Отправляется один раз за период неактивности: не повторяем, если предупреждение уже
//   есть в БД и создано позже последнего взаимодействия клиента.
// - Время отправки — 10:00 по Europe/Kaliningrad (MVP: фиксированный пояс студии).

import { subHours } from 'date-fns';
import { format, toZonedTime } from 'date-fns-tz';
import { Op } from 'sequelize';
import {
  Client,
  ClientEnrollment,
  DEFAULT_TIMEZONE,
  Message,
  NotificationSettings,
  sendTelegramMessageWithRetry,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';

interface ClientWithAssociations extends Client {
  notificationSettings?: NotificationSettings;
  enrollments?: ClientEnrollment[];
}

const WARNING_TIME = '10:00';
const INACTIVITY_HOURS = 48;

const WARNING_TEXT =
  'Мы заметили, что ты не со мной уже два дня. Завтра я пойду на перерыв и перестану отправлять напоминания. Но я всегда здесь, если тебе нужна помощь! 🤗';

export async function runInactivityWarningJob(logger: Logger): Promise<void> {
  const now = new Date();
  const inactivityThreshold = subHours(now, INACTIVITY_HOURS);

  const clients = await Client.findAll({
    include: [
      {
        model: NotificationSettings,
        as: 'notificationSettings',
        required: true,
        where: {
          enabled: true,
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
      lastInteractionAt: { [Op.lt]: inactivityThreshold },
    },
  });

  logger.info({ count: clients.length }, 'Выборка клиентов для предупреждения о неактивности');

  for (const client of clients) {
    const clientWithAssoc = client as ClientWithAssociations;
    const settings = clientWithAssoc.notificationSettings;
    const enrollment = clientWithAssoc.enrollments?.[0];
    if (!settings || !enrollment) continue;

    const timezone = DEFAULT_TIMEZONE;
    const zonedNow = toZonedTime(now, timezone);
    const currentTime = format(zonedNow, 'HH:mm', { timeZone: timezone });

    if (currentTime !== WARNING_TIME) {
      continue;
    }

    const hasRecentWarning = await hasInactivityWarningAfter(client.id, client.lastInteractionAt);
    if (hasRecentWarning) {
      logger.debug(
        { clientId: client.id },
        'Предупреждение о неактивности уже отправлялось после последнего взаимодействия',
      );
      continue;
    }

    try {
      await sendTelegramMessageWithRetry({
        telegramId: client.telegramId!,
        text: WARNING_TEXT,
        clientId: client.id,
        type: 'inactivity_warning',
        category: 'optional',
      });
      logger.info(
        { clientId: client.id, time: currentTime, timezone },
        'Предупреждение о неактивности отправлено',
      );
    } catch (err) {
      logger.error(
        { clientId: client.id, err },
        'Не удалось отправить предупреждение о неактивности',
      );
    }
  }
}

async function hasInactivityWarningAfter(
  clientId: string,
  lastInteractionAt: Date | null,
): Promise<boolean> {
  const where: Record<string, unknown> = {
    clientId,
    type: 'inactivity_warning',
  };

  if (lastInteractionAt) {
    where.createdAt = { [Op.gt]: lastInteractionAt };
  }

  const count = await Message.count({ where });
  return count > 0;
}
