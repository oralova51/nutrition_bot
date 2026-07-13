// Создание экземпляра grammY-бота: подключение middleware (Client-контекст, roadmap 2.2)
// и централизованного обработчика ошибок. nonFR §6: сбои должны логироваться структурированно.

import { Bot, GrammyError, HttpError } from 'grammy';
import type { Logger } from 'pino';
import { createStartHandler } from './commands/start.js';
import type { BotContext } from './context.js';
import { handleSettingsCallback, handleSettingsCommand } from './handlers/settings-handler.js';
import { onboardingMessageHandler } from './handlers/onboarding-handler.js';
import { createClientContextMiddleware } from './middleware/client-context.js';

export function createBot(token: string, logger: Logger): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  bot.use(createClientContextMiddleware(logger));

  bot.command('start', createStartHandler(logger));
  bot.command('settings', handleSettingsCommand);

  bot.callbackQuery(/^settings:/, handleSettingsCallback);
  bot.on('message:text', onboardingMessageHandler);

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
