// Автоотключение уведомлений по неактивности: 72+ ч без сообщений → отключение (roadmap 6.4–6.5, ФТ-10).
//
// Бизнес-правила:
// - Отключаются только клиенты с активным enrollment и включёнными уведомлениями.
// - Устанавливается `enabled = false` и `disabledReason = 'inactivity'`.
// - Создаётся запись в `Message` (transactional) как лог деактивации для админ-панели.
// - Не отключает повторно, если уведомления уже отключены.

import { subHours } from 'date-fns';
import { Op } from 'sequelize';
import { Client, ClientEnrollment, Message, NotificationSettings } from '@nutrition-bot/shared';
import type { Logger } from 'pino';

interface ClientWithAssociations extends Client {
  notificationSettings?: NotificationSettings;
  enrollments?: ClientEnrollment[];
}

const INACTIVITY_HOURS = 72;
const DEACTIVATION_LOG_TEXT = 'Уведомления отключены автоматически из-за неактивности (72+ ч).';

export async function runInactivityDeactivationJob(logger: Logger): Promise<void> {
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

  logger.info(
    { count: clients.length },
    'Выборка клиентов для автоотключения уведомлений по неактивности',
  );

  for (const client of clients) {
    const clientWithAssoc = client as ClientWithAssociations;
    const settings = clientWithAssoc.notificationSettings;
    if (!settings) continue;

    try {
      await settings.update({ enabled: false, disabledReason: 'inactivity' });

      await Message.create({
        clientId: client.id,
        type: 'info',
        category: 'transactional',
        content: DEACTIVATION_LOG_TEXT,
        channel: 'telegram',
        deliveryStatus: 'sent',
        retryCount: 0,
      });

      logger.info(
        { clientId: client.id, lastInteractionAt: client.lastInteractionAt },
        'Уведомления отключены автоматически по неактивности',
      );
    } catch (err) {
      logger.error(
        { clientId: client.id, err },
        'Не удалось отключить уведомления по неактивности',
      );
    }
  }
}
