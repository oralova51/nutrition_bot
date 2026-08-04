// Обработчик feedback в конце курса (roadmap 7.11–7.16, ФТ-15, ФТ-16, ФТ-17).
// Обрабатывает inline-кнопки оценки 1–5 звёзд и текстовые комментарии для низкой оценки.

import type { CallbackQueryContext } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { Feedback, Message, sendTelegramMessage } from '@nutrition-bot/shared';
import type { BotContext } from '../context.js';
import { resolveReviewUrls } from '../config.js';

const REVIEW_URLS = resolveReviewUrls();

const THANKS_LOW_RATING_MESSAGE =
  'Спасибо, что поделились мнением. Помоги нам улучшиться: какие рекомендации были неполезны или неточны?\n\n' +
  'Напиши, пожалуйста, развёрнутый комментарий — я передам его администратору студии.';

const THANKS_HIGH_RATING_MESSAGE =
  'Спасибо! Мы рады, что рекомендации были полезны для вас 💚\n\n' +
  'Если есть минута, оставь отзыв на одной из площадок — в знак благодарности мы подарим бесплатный сеанс прессотерапии!\n\n' +
  'Выбери, где удобнее:';

const COMMENT_SAVED_MESSAGE =
  'Спасибо за развёрнутый ответ. Мы обязательно разберёмся и улучшим сервис.';

const ADMIN_FEEDBACK_PREFIX = '⚠️ Критическая обратная связь (1–3 звезды)';

function buildReviewKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .row(
      InlineKeyboard.text('2GIS', 'review:2gis'),
      InlineKeyboard.text('Яндекс.Карты', 'review:yandex'),
    )
    .row(InlineKeyboard.text('Не сейчас', 'review:dismiss'));
}

function buildCommentPromptKeyboard(): InlineKeyboard {
  // Кнопка позволяет отказаться от комментария; после пропуска текстовые сообщения больше не поглощаются.
  return new InlineKeyboard().row(InlineKeyboard.text('Пропустить', 'feedback:skip_comment'));
}

async function findLastCourseFeedback(clientId: string): Promise<Feedback | null> {
  return Feedback.findOne({
    where: { clientId, source: 'course_final' },
    order: [['createdAt', 'DESC']],
  });
}

async function saveRating(clientId: string, rating: number): Promise<Feedback> {
  const existing = await findLastCourseFeedback(clientId);
  if (existing) {
    await existing.update({ rating, comment: null });
    return existing;
  }

  return Feedback.create({
    clientId,
    recommendationId: null,
    rating,
    comment: null,
    isApplied: null,
    source: 'course_final',
  });
}

async function notifyAdminLowRating(feedback: Feedback): Promise<void> {
  const content = [
    ADMIN_FEEDBACK_PREFIX,
    `Клиент: ${feedback.clientId}`,
    `Оценка: ${feedback.rating} ⭐`,
    feedback.comment ? `Комментарий: ${feedback.comment}` : 'Комментарий: не предоставлен',
  ].join('\n');

  await Message.create({
    clientId: feedback.clientId,
    type: 'feedback',
    category: 'transactional',
    content,
    channel: 'telegram',
    deliveryStatus: 'sent',
    retryCount: 0,
  });
}

async function sendBonusLogMessage(clientId: string): Promise<void> {
  await Message.create({
    clientId,
    type: 'feedback',
    category: 'transactional',
    content: 'Предложен бонус (бесплатный сеанс прессотерапии) за отзыв на 4–5 звёзд.',
    channel: 'telegram',
    deliveryStatus: 'sent',
    retryCount: 0,
  });
}

async function handleStarRating(
  ctx: CallbackQueryContext<BotContext>,
  rating: number,
): Promise<void> {
  if (!ctx.client) {
    await ctx.answerCallbackQuery({ text: 'Не удалось определить клиента.' });
    return;
  }

  await saveRating(ctx.client.id, rating);

  if (rating <= 3) {
    await ctx.editMessageText(THANKS_LOW_RATING_MESSAGE, {
      reply_markup: buildCommentPromptKeyboard(),
    });
  } else {
    await ctx.editMessageText(THANKS_HIGH_RATING_MESSAGE, {
      reply_markup: buildReviewKeyboard(),
    });
    await sendBonusLogMessage(ctx.client.id);
  }

  await ctx.answerCallbackQuery({ text: 'Спасибо за оценку!' });
}

async function handleSkipComment(ctx: CallbackQueryContext<BotContext>): Promise<void> {
  if (!ctx.client) {
    await ctx.answerCallbackQuery();
    return;
  }

  const feedback = await findLastCourseFeedback(ctx.client.id);
  if (feedback && feedback.rating <= 3) {
    await feedback.update({ comment: '' });
    await notifyAdminLowRating(feedback);
  }

  await ctx.editMessageText('Хорошо, если передумаешь — напиши комментарий позже.');
  await ctx.answerCallbackQuery();
}

async function handleReviewLink(
  ctx: CallbackQueryContext<BotContext>,
  platform: string,
): Promise<void> {
  if (!ctx.client) {
    await ctx.answerCallbackQuery();
    return;
  }

  const url = platform === '2gis' ? REVIEW_URLS.gis2 : REVIEW_URLS.yandex;
  const text = `Отлично! Переходи по ссылке, оставь отзыв и покажи его администратору студии — мы зафиксируем бонус.\n\n${url}`;

  await ctx.editMessageText(text, { reply_markup: { inline_keyboard: [] } });
  await ctx.answerCallbackQuery({ text: 'Спасибо!' });
}

async function handleReviewDismiss(ctx: CallbackQueryContext<BotContext>): Promise<void> {
  if (!ctx.client) {
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.editMessageText(
    'Поняла! Если передумаешь — ссылка всегда доступна в настройках студии.',
    { reply_markup: { inline_keyboard: [] } },
  );
  await ctx.answerCallbackQuery();
}

export async function handleFeedbackCallback(ctx: CallbackQueryContext<BotContext>): Promise<void> {
  const callbackData = ctx.callbackQuery.data;
  if (!callbackData || !ctx.client) {
    await ctx.answerCallbackQuery();
    return;
  }

  const parts = callbackData.split(':');
  if (parts[0] !== 'feedback' && parts[0] !== 'review') {
    await ctx.answerCallbackQuery();
    return;
  }

  const domain = parts[0];
  const action = parts[1];

  if (domain === 'feedback') {
    switch (action) {
      case 'stars': {
        const rating = Number(parts[2]);
        if (Number.isNaN(rating) || rating < 1 || rating > 5) {
          await ctx.answerCallbackQuery({ text: 'Некорректная оценка.' });
          return;
        }
        await handleStarRating(ctx, rating);
        return;
      }
      case 'skip_comment': {
        await handleSkipComment(ctx);
        return;
      }
      default: {
        await ctx.answerCallbackQuery();
        return;
      }
    }
  }

  if (domain === 'review') {
    switch (action) {
      case '2gis':
      case 'yandex': {
        await handleReviewLink(ctx, action);
        return;
      }
      case 'dismiss': {
        await handleReviewDismiss(ctx);
        return;
      }
      default: {
        await ctx.answerCallbackQuery();
        return;
      }
    }
  }
}

/**
 * Сохраняет текстовый комментарий к последнему курсовому feedback (1–3 звезды).
 * Вызывается из общего текстового обработчика, когда клиент пишет после запроса комментария.
 */
export async function handleFeedbackComment(ctx: BotContext, text: string): Promise<boolean> {
  if (!ctx.client) return false;

  const feedback = await findLastCourseFeedback(ctx.client.id);
  if (!feedback || feedback.rating > 3 || feedback.comment !== null) {
    return false;
  }

  await feedback.update({ comment: text });
  await sendTelegramMessage({
    telegramId: ctx.client.telegramId!,
    text: COMMENT_SAVED_MESSAGE,
    clientId: ctx.client.id,
    type: 'feedback',
    category: 'transactional',
  });
  await notifyAdminLowRating(feedback);
  return true;
}
