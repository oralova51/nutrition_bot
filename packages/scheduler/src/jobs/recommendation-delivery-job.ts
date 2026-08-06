// Отложенная отправка рекомендаций medium/low в 20:00 по часовому поясу клиента.
// Roadmap 5.8: medium/low рекомендации создаются сразу, но отправляются вечером.

import { format, toZonedTime } from 'date-fns-tz';
import { Op } from 'sequelize';
import {
  Client,
  Message,
  NotificationSettings,
  Recommendation,
  sendTelegramMessageWithRetry,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';

interface RecommendationWithClient extends Recommendation {
  client?: Client | null;
}

export async function runRecommendationDeliveryJob(logger: Logger): Promise<void> {
  const now = new Date();
  const recommendations = await Recommendation.findAll({
    where: {
      priority: { [Op.in]: ['medium', 'low'] },
      status: 'sent',
      content: { [Op.ne]: null },
      createdAt: { [Op.gte]: getUtcStartOfDay(now) },
    },
    include: [
      {
        model: Client,
        as: 'client',
        required: true,
        where: { telegramId: { [Op.ne]: null } },
      },
    ],
  });

  logger.info({ count: recommendations.length }, 'Выборка отложенных рекомендаций для отправки');

  for (const recommendation of recommendations) {
    const client = (recommendation as RecommendationWithClient).client;
    if (!client?.telegramId) continue;

    const settings = await NotificationSettings.findOne({ where: { clientId: client.id } });
    if (!settings || !settings.enabled || !settings.enabledTypes.includes('recommendations')) {
      continue;
    }

    const timezone = settings.timezone;
    const zonedNow = toZonedTime(now, timezone);
    const currentTime = format(zonedNow, 'HH:mm', { timeZone: timezone });
    if (currentTime !== '20:00') {
      continue;
    }

    const alreadySent = await hasRecommendationMessage(recommendation.id);
    if (alreadySent) {
      continue;
    }

    try {
      const result = await sendTelegramMessageWithRetry({
        telegramId: client.telegramId,
        text: recommendation.content!,
        clientId: client.id,
        type: 'recommendation',
        category: 'optional',
      });
      await result.message.update({ recommendationId: recommendation.id });
      logger.info(
        {
          clientId: client.id,
          recommendationId: recommendation.id,
          priority: recommendation.priority,
        },
        'Отложенная рекомендация отправлена',
      );
    } catch (err) {
      logger.error(
        { clientId: client.id, recommendationId: recommendation.id, err },
        'Не удалось отправить отложенную рекомендацию',
      );
    }
  }
}

async function hasRecommendationMessage(recommendationId: string): Promise<boolean> {
  const count = await Message.count({
    where: {
      recommendationId,
      type: 'recommendation',
    },
  });
  return count > 0;
}

function getUtcStartOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}
