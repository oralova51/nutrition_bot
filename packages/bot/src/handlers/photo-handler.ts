// Обработчик входящих фото. Vision/OCR отложен (roadmap 5.11), поэтому
// запись в дневник не создаём — просим описать блюдо текстом.
// Сработает только для клиентов с завершённым онбордингом.

import type { BotContext } from '../context.js';

const NO_COURSE_MESSAGE =
  'У вас пока нет активного курса. Обратитесь к администратору студии — он вышлет персональную ссылку-приглашение.';

const ONBOARDING_NOT_COMPLETED_MESSAGE =
  'Сначала завершите анкету и настройки уведомлений — после этого я смогу принимать записи о питании.';

const PHOTO_NOT_SUPPORTED_MESSAGE =
  'К сожалению, я пока не могу распознавать фотографии 😌. Пришли мне, пожалуйста, то, что ты съел текстом.';

export async function photoMessageHandler(ctx: BotContext): Promise<void> {
  if (!ctx.client || !ctx.enrollment) {
    await ctx.reply(NO_COURSE_MESSAGE);
    return;
  }

  if (ctx.enrollment.onboardingStatus !== 'completed') {
    await ctx.reply(ONBOARDING_NOT_COMPLETED_MESSAGE);
    return;
  }

  // handleNutritionDiaryPhoto не вызываем, пока нет vision (roadmap 5.11).
  await ctx.reply(PHOTO_NOT_SUPPORTED_MESSAGE);
}
