// Обработчик добровольного отключения уведомлений: /stop и /pause (roadmap 6.6–6.8, ФТ-12).
//
// MVP: реализовано только «отключить полностью» (временные варианты «на день / неделю» отложены).
// После подтверждения уведомления отключаются с `disabledReason = 'user_request'`.

import type { CallbackQueryContext, CommandContext } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { NotificationSettings } from '@nutrition-bot/shared';
import type { BotContext } from '../context.js';

const MENU_TEXT =
  'Если напоминания стали мешать, я могу отключить их полностью.\n\n' +
  'Ты всегда сможешь снова включить их командой /start.';

const CONFIRM_TEXT = 'Ты уверен? Ты всегда можешь снова включить уведомления командой /start.';

const DISABLED_TEXT = 'Уведомления отключены. Если захочешь вернуться — просто отправь /start.';

const NO_ACTIVE_COURSE_TEXT =
  'У вас пока нет активного курса. Обратитесь к администратору студии — он вышлет персональную ссылку-приглашение.';

function buildMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard().row(
    InlineKeyboard.text('Отключить полностью', 'stop:confirm'),
  );
}

function buildConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .row(InlineKeyboard.text('Да, отключить', 'stop:disable'))
    .row(InlineKeyboard.text('Отмена', 'stop:cancel'));
}

async function getSettings(clientId: string): Promise<NotificationSettings | null> {
  return NotificationSettings.findOne({ where: { clientId } });
}

export async function handleStopCommand(ctx: CommandContext<BotContext>): Promise<void> {
  if (!ctx.client) {
    await ctx.reply(NO_ACTIVE_COURSE_TEXT);
    return;
  }

  await ctx.reply(MENU_TEXT, { reply_markup: buildMenuKeyboard() });
}

export async function handlePauseCommand(ctx: CommandContext<BotContext>): Promise<void> {
  // В MVP /pause идентичен /stop: отключает уведомления полностью.
  await handleStopCommand(ctx);
}

export async function handleOptOutCallback(ctx: CallbackQueryContext<BotContext>): Promise<void> {
  const callbackData = ctx.callbackQuery.data;
  if (!callbackData || !ctx.client) {
    await ctx.answerCallbackQuery();
    return;
  }

  const parts = callbackData.split(':');
  if (parts[0] !== 'stop' && parts[0] !== 'pause') {
    await ctx.answerCallbackQuery();
    return;
  }

  const action = parts[1];
  const settings = await getSettings(ctx.client.id);
  if (!settings) {
    await ctx.answerCallbackQuery({ text: 'Настройки уведомлений не найдены.' });
    return;
  }

  switch (action) {
    case 'confirm': {
      await ctx.editMessageText(CONFIRM_TEXT, { reply_markup: buildConfirmKeyboard() });
      break;
    }
    case 'disable': {
      await settings.update({ enabled: false, disabledReason: 'user_request' });
      await ctx.editMessageText(DISABLED_TEXT, { reply_markup: { inline_keyboard: [] } });
      break;
    }
    case 'cancel': {
      await ctx.editMessageText(
        'Хорошо, уведомления остаются включёнными. Если передумаешь — отправь /stop или /pause.',
        { reply_markup: { inline_keyboard: [] } },
      );
      break;
    }
    default: {
      await ctx.answerCallbackQuery();
      return;
    }
  }

  await ctx.answerCallbackQuery();
}
