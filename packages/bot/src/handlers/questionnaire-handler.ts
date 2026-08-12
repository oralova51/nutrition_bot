// Обработчик inline-кнопок анкеты онбординга (callback_data: q:…).
// SA/adminAPI.md §6.4: примеры `q:4:opt:2`.

import type { CallbackQueryContext } from 'grammy';
import type { BotContext } from '../context.js';
import { handleQuestionnaireCallback } from '../services/onboarding.js';

export async function handleQuestionnaireButton(
  ctx: CallbackQueryContext<BotContext>,
): Promise<void> {
  const callbackData = ctx.callbackQuery.data;
  if (!callbackData || !ctx.enrollment) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (ctx.enrollment.onboardingStatus !== 'in_progress') {
    await ctx.answerCallbackQuery({ text: 'Анкета сейчас недоступна.' });
    return;
  }

  await handleQuestionnaireCallback(ctx, ctx.enrollment, callbackData);
}
