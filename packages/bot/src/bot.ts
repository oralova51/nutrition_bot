// Создание экземпляра grammY-бота и централизованного обработчика ошибок middleware.
// nonFR §6: сбои должны логироваться структурированно.

import { Bot, GrammyError, HttpError } from 'grammy';
import type { Logger } from 'pino';

export function createBot(token: string, logger: Logger): Bot {
  const bot = new Bot(token);

  bot.catch((err) => {
    const { ctx, error } = err;
    const context = { updateId: ctx.update.update_id, err: error };

    if (error instanceof GrammyError) {
      logger.error(context, 'Telegram Bot API вернул ошибку при обработке update');
    } else if (error instanceof HttpError) {
      logger.error(context, 'Не удалось связаться с Telegram Bot API');
    } else {
      logger.error(context, 'Необработанная ошибка при обработке update');
    }
  });

  return bot;
}
