// Публичное меню команд бота (Telegram setMyCommands) и обработчики /site, /buy.
// /settings уже зарегистрирован в bot.ts; здесь только список меню и ссылочные команды.

import type { Bot, CommandContext } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { Logger } from 'pino';
import { resolveCompanySiteUrl, resolveSubscriptionCheckoutUrl } from '../config.js';
import type { BotContext } from '../context.js';

/** Команды в кнопке Menu у поля ввода. Имена — только латиница (ограничение Telegram). */
export const BOT_COMMANDS = [
  { command: 'settings', description: 'Настройки уведомлений' },
  { command: 'site', description: 'Сайт компании' },
  { command: 'buy', description: 'Купить абонемент' },
] as const;

export const SITE_MESSAGE = 'Сайт студии LPG39:';
export const BUY_MESSAGE = 'Оформить абонемент можно по ссылке ниже.';
export const BUY_UNAVAILABLE_MESSAGE =
  'Ссылка на оплату абонемента скоро появится. Напишите администратору студии, если хотите оформить его сейчас.';

export async function registerBotCommands(bot: Bot<BotContext>, logger: Logger): Promise<void> {
  try {
    await bot.api.setMyCommands([...BOT_COMMANDS]);
    logger.info(
      { commands: BOT_COMMANDS.map((item) => item.command) },
      'Меню команд бота зарегистрировано',
    );
  } catch (err) {
    logger.error({ err }, 'Не удалось зарегистрировать меню команд');
  }
}

export async function handleSiteCommand(ctx: CommandContext<BotContext>): Promise<void> {
  const url = resolveCompanySiteUrl();
  await ctx.reply(SITE_MESSAGE, {
    reply_markup: new InlineKeyboard().url('Открыть сайт', url),
  });
}

export async function handleBuyCommand(ctx: CommandContext<BotContext>): Promise<void> {
  const url = resolveSubscriptionCheckoutUrl();
  if (!url) {
    await ctx.reply(BUY_UNAVAILABLE_MESSAGE);
    return;
  }

  await ctx.reply(BUY_MESSAGE, {
    reply_markup: new InlineKeyboard().url('Купить абонемент', url),
  });
}
