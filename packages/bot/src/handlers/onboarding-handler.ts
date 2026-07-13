// Обработчик входящих текстовых сообщений: маршрутизация по onboardingStatus.
// roadmap 3.8: state machine онбординга — welcome → questionnaire → settings.

import type { BotContext } from '../context.js';
import {
  completeQuestionnaire,
  continueQuestionnaire,
  handleQuestionnaireAnswer,
  startOnboarding,
} from '../services/onboarding.js';

const NO_ENROLLMENT_MESSAGE =
  'У вас пока нет активного курса. Обратитесь к администратору студии — он вышлет персональную ссылку-приглашение.';

const AWAITING_LINK_MESSAGE =
  'Привет! Я бот-консультант по питанию 🙂\n\n' +
  'Чтобы начать работу, мне нужна персональная ссылка-приглашение от администратора вашей студии.';

export async function onboardingMessageHandler(ctx: BotContext): Promise<void> {
  if (!ctx.client) {
    await ctx.reply(AWAITING_LINK_MESSAGE);
    return;
  }

  if (!ctx.enrollment) {
    await ctx.reply(NO_ENROLLMENT_MESSAGE);
    return;
  }

  const text = ctx.message?.text?.trim() ?? '';
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
      // Переход к настройкам уведомлений (ФТ-3) реализуется на этапе 3C.
      // Повторное сообщение напоминает клиенту, что нужно настроить уведомления.
      await completeQuestionnaire(ctx, ctx.enrollment);
      break;
    case 'completed':
      // Основной режим (этап 4) — пока нет обработчика, ничего не делаем.
      break;
    default:
      // Для unknown status продолжаем анкету как наиболее безопасный fallback.
      await continueQuestionnaire(ctx, ctx.enrollment);
  }
}
