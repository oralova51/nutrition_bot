// Обработчик входящих текстовых сообщений: маршрутизация по onboardingStatus.
// roadmap 3.8: state machine онбординга — welcome → questionnaire → settings.

import type { BotContext } from '../context.js';
import { handleFeedbackComment } from './feedback-handler.js';
import { handleNutritionDiaryEntry } from '../services/nutrition-diary.js';
import {
  continueQuestionnaire,
  handleQuestionnaireAnswer,
  startOnboarding,
} from '../services/onboarding.js';
import { startSettingsWizard } from './settings-handler.js';

const NO_ENROLLMENT_MESSAGE =
  'У вас пока нет активного курса. Обратитесь к администратору студии — он вышлет персональную ссылку-приглашение.';

const AWAITING_LINK_MESSAGE =
  'Привет! Я бот-консультант по питанию 🙂\n\n' +
  'Чтобы начать работу, мне нужна персональная ссылка-приглашение от администратора вашей студии.';

export async function onboardingMessageHandler(ctx: BotContext): Promise<void> {
  // grammY вызывает и command-, и message:text-хендлеры для `/start` и др. —
  // команды обрабатываются отдельно, сюда их не пускаем.
  const rawText = ctx.message?.text ?? '';
  if (rawText.startsWith('/')) {
    return;
  }

  if (!ctx.client) {
    await ctx.reply(AWAITING_LINK_MESSAGE);
    return;
  }

  if (!ctx.enrollment) {
    await ctx.reply(NO_ENROLLMENT_MESSAGE);
    return;
  }

  const text = rawText.trim();
  const status = ctx.enrollment.onboardingStatus;

  switch (status) {
    case 'pending':
      await startOnboarding(ctx, ctx.enrollment);
      break;
    case 'in_progress': {
      if (text === '') {
        await continueQuestionnaire(ctx, ctx.enrollment);
        return;
      }
      await handleQuestionnaireAnswer(ctx, ctx.enrollment, text);
      break;
    }
    case 'settings_pending':
      // Переход к настройкам уведомлений (ФТ-3): запускаем wizard.
      await startSettingsWizard(ctx);
      break;
    case 'completed': {
      // Сначала проверяем, не является ли сообщение комментарием к низкой оценке (ФТ-16).
      if (text !== '' && (await handleFeedbackComment(ctx, text))) {
        return;
      }

      // Основной режим: приём записей дневника питания (roadmap 4.9–4.12).
      if (text === '') {
        await ctx.reply('Напишите, пожалуйста, что вы съели — я запишу это в дневник. Я прошу писать подробно, с пометками о количестве съеденного и состава блюда. Например, я съела 2 яйца, 1 средний помидор, выпила стакан черного кофе и съела 10 г горького шоколада без сахара.');
        return;
      }
      await handleNutritionDiaryEntry(ctx, text);
      break;
    }
    default:
      // Для unknown status продолжаем анкету как наиболее безопасный fallback.
      await continueQuestionnaire(ctx, ctx.enrollment);
  }
}
