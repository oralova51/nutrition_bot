// Middleware: по telegramId входящего update ищет привязанного Client и кладёт его в ctx.
// roadmap 2.2.
//
// Создание Client здесь не выполняется: клиент заводится администратором заранее
// (adminAPI.md §3 EnrollmentLink, §4.2 POST /admin/clients) с telegramId=null и получает
// telegramId только при активации enrollment-ссылки (roadmap 2.4–2.5). Update от
// telegramId без привязанного Client (например, /start без ссылки) проходит дальше
// без ctx.client — такие случаи обрабатывает хендлер /start на шаге 2.3.

import { Client, ClientEnrollment } from '@nutrition-bot/shared';
import type { NextFunction } from 'grammy';
import type { Logger } from 'pino';
import type { BotContext } from '../context.js';

export function createClientContextMiddleware(
  logger: Logger,
): (ctx: BotContext, next: NextFunction) => Promise<void> {
  return async function clientContextMiddleware(
    ctx: BotContext,
    next: NextFunction,
  ): Promise<void> {
    const telegramId = ctx.from?.id;
    if (telegramId === undefined) {
      await next();
      return;
    }

    const client = await Client.findOne({ where: { telegramId: telegramId.toString() } });

    if (!client) {
      logger.debug(
        { telegramId },
        'Client с таким telegramId не найден — ссылка-приглашение ещё не активирована',
      );
      await next();
      return;
    }

    const telegramUsername = ctx.from?.username ?? null;
    await client.update({
      lastInteractionAt: new Date(),
      ...(telegramUsername !== client.telegramUsername ? { telegramUsername } : {}),
    });

    ctx.client = client;

    const enrollment = await ClientEnrollment.findOne({
      where: {
        clientId: client.id,
        status: ['active', 'paused', 'completed'],
        onboardingStatus: ['pending', 'in_progress', 'settings_pending', 'completed'],
      },
      order: [['startDate', 'DESC']],
    });

    if (enrollment) {
      ctx.enrollment = enrollment;
    } else {
      logger.debug({ clientId: client.id }, 'Не найден активный enrollment для онбординга');
    }

    await next();
  };
}
