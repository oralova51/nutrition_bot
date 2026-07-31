// Обработчик входящих фото: сохранение в дневник питания (roadmap 4.13).
// Сработает только для клиентов с завершённым онбордингом.

import type { BotContext } from '../context.js';
import { handleNutritionDiaryPhoto } from '../services/nutrition-diary.js';

const NO_COURSE_MESSAGE =
  'У вас пока нет активного курса. Обратитесь к администратору студии — он вышлет персональную ссылку-приглашение.';

const ONBOARDING_NOT_COMPLETED_MESSAGE =
  'Сначала завершите анкету и настройки уведомлений — после этого я смогу принимать фото еды.';

export async function photoMessageHandler(ctx: BotContext): Promise<void> {
  if (!ctx.client || !ctx.enrollment) {
    await ctx.reply(NO_COURSE_MESSAGE);
    return;
  }

  if (ctx.enrollment.onboardingStatus !== 'completed') {
    await ctx.reply(ONBOARDING_NOT_COMPLETED_MESSAGE);
    return;
  }

  await handleNutritionDiaryPhoto(ctx);
}
