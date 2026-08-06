// Обработчик callback продления курса (roadmap 8.2, ФТ-18).
// При нажатии «Продлить курс» фиксирует статус clicked после успешной доставки ссылки.

import type { CallbackQueryContext } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { RenewalOffer, resolveRenewalConfig, sendTelegramMessage } from '@nutrition-bot/shared';
import type { BotContext } from '../context.js';

const RENEWAL_ACCEPTED_MESSAGE =
  'Отлично! Оформить продление можно по ссылке ниже. Жду тебя на новом курсе 💚';

function buildCheckoutKeyboard(url: string): InlineKeyboard {
  return new InlineKeyboard().row(InlineKeyboard.url('Оформить продление', url));
}

export async function handleRenewalCallback(ctx: CallbackQueryContext<BotContext>): Promise<void> {
  if (!ctx.client) {
    await ctx.answerCallbackQuery({ text: 'Не удалось определить клиента.' });
    return;
  }

  const callbackData = ctx.callbackQuery.data;
  if (!callbackData) {
    await ctx.answerCallbackQuery();
    return;
  }

  const parts = callbackData.split(':');
  if (parts.length !== 3 || parts[0] !== 'renewal' || parts[1] !== 'accept') {
    await ctx.answerCallbackQuery();
    return;
  }

  const offerId = parts[2];
  const offer = await RenewalOffer.findByPk(offerId);
  if (!offer || offer.clientId !== ctx.client.id || offer.status !== 'sent') {
    await ctx.answerCallbackQuery({ text: 'Предложение не найдено или уже обработано.' });
    return;
  }

  const checkoutUrl = offer.checkoutUrl || resolveRenewalConfig().checkoutUrl;

  try {
    await ctx.editMessageText(RENEWAL_ACCEPTED_MESSAGE, {
      reply_markup: buildCheckoutKeyboard(checkoutUrl),
    });

    await sendTelegramMessage({
      telegramId: ctx.client.telegramId!,
      text: `Ссылка для оформления продления: ${checkoutUrl}`,
      clientId: ctx.client.id,
      type: 'renewal_offer',
      category: 'transactional',
    });

    await offer.update({ status: 'clicked', clickedAt: new Date() });
    await ctx.answerCallbackQuery({ text: 'Спасибо! Ссылка отправлена.' });
  } catch (err) {
    await ctx.answerCallbackQuery({ text: 'Не удалось отправить ссылку. Попробуйте позже.' });
    throw err;
  }
}
