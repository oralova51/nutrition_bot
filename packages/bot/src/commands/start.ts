// Хендлер команды /start. roadmap 2.3: минимальная заглушка — клиент подключается
// только по персональной ссылке-приглашению от администратора (ФТ-1, adminAPI.md §3).
// Разбор deep link с enrollment-кодом из ctx.match — следующий шаг 2.4.

import type { CommandContext } from 'grammy';
import type { Logger } from 'pino';
import type { BotContext } from '../context.js';

const AWAITING_LINK_MESSAGE =
  'Привет! Я бот-консультант по питанию 🙂\n\n' +
  'Чтобы начать работу, мне нужна персональная ссылка-приглашение от администратора вашей студии. ' +
  'Как только она придёт — перейдите по ней, и мы продолжим отсюда.';

export function createStartHandler(
  logger: Logger,
): (ctx: CommandContext<BotContext>) => Promise<void> {
  return async function startHandler(ctx: CommandContext<BotContext>): Promise<void> {
    logger.info(
      { telegramId: ctx.from?.id, hasClient: Boolean(ctx.client), payload: ctx.match },
      'Получена команда /start',
    );

    await ctx.reply(AWAITING_LINK_MESSAGE);
  };
}
