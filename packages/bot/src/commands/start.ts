// Хендлер команды /start. roadmap 2.3: заглушка «ожидаем ссылку подключения» при
// отсутствии payload. roadmap 2.4–2.6: разбор deep link с enrollment-кодом, привязка
// telegramId к ClientEnrollment и логирование попытки — см.
// services/enrollment-link-activation.ts (ФТ-1, adminAPI.md §2, §3, §5).

import type { CommandContext } from 'grammy';
import type { Logger } from 'pino';
import { NotificationSettings, type ClientEnrollment } from '@nutrition-bot/shared';
import type { BotContext } from '../context.js';
import { sendDiaryQuickGuide, startSettingsWizard } from '../handlers/settings-handler.js';
import { findEnrollmentForClient } from '../services/enrollment-context.js';
import {
  activateEnrollmentLink,
  type ActivationErrorCode,
} from '../services/enrollment-link-activation.js';
import { continueQuestionnaire, startOnboarding } from '../services/onboarding.js';

const AWAITING_LINK_MESSAGE =
  'Привет! Я бот-консультант по питанию 🙂\n\n' +
  'Чтобы начать работу, мне нужна персональная ссылка-приглашение от администратора вашей студии. ' +
  'Как только она придёт — перейдите по ней, и мы продолжим отсюда.';

const WELCOME_BACK_MESSAGE = 'Привет снова! Уведомления включены, продолжим работу над питанием 🙂';

const ACTIVATION_SUCCESS_MESSAGE =
  'Отлично, вы подключены к курсу! Сейчас познакомимся поближе и зададим несколько коротких вопросов.';

/** ФТ-18: повторный/продлённый курс — анкета уже пройдена, сразу дневник. */
const RENEWAL_READY_MESSAGE =
  'С возвращением! Новый курс уже активен — можете сразу писать, что съели 🙂';

const ACTIVATION_ERROR_MESSAGES: Record<ActivationErrorCode, string> = {
  INVALID_CODE:
    'Такой ссылки не существует. Проверьте, что вы перешли по ней полностью, ' +
    'или обратитесь к администратору студии за новой.',
  LINK_EXPIRED: 'Эта ссылка истекла. Обратитесь к администратору студии — он отправит новую.',
  ALREADY_USED:
    'Эта ссылка уже была использована ранее. Если это не вы — обратитесь к администратору студии.',
  ENROLLMENT_CANCELLED:
    'Курс, к которому относится эта ссылка, был отменён. Обратитесь к администратору студии.',
};

const INTERNAL_ERROR_MESSAGE =
  'Что-то пошло не так при подключении. Попробуйте ещё раз чуть позже или обратитесь к администратору студии.';

/**
 * Ведём клиента по фактическому onboardingStatus.
 * Первая активация ссылки показывает «вы подключены»; повторный /start только
 * продолжает текущий шаг и не запускает анкету заново.
 */
async function continueSession(
  ctx: CommandContext<BotContext>,
  enrollment: ClientEnrollment,
  isNewActivation: boolean,
): Promise<void> {
  switch (enrollment.onboardingStatus) {
    case 'completed':
      await ctx.reply(isNewActivation ? RENEWAL_READY_MESSAGE : WELCOME_BACK_MESSAGE);
      // Повторный курс не гоняет визард настроек — памятку шлём здесь, из актуального текста.
      if (isNewActivation) {
        await sendDiaryQuickGuide(ctx);
      }
      return;
    case 'settings_pending':
      if (isNewActivation) {
        await ctx.reply(ACTIVATION_SUCCESS_MESSAGE);
      }
      await startSettingsWizard(ctx);
      return;
    case 'in_progress':
      if (isNewActivation) {
        await ctx.reply(ACTIVATION_SUCCESS_MESSAGE);
      }
      await continueQuestionnaire(ctx, enrollment);
      return;
    case 'pending':
    default:
      if (isNewActivation) {
        await ctx.reply(ACTIVATION_SUCCESS_MESSAGE);
      }
      await startOnboarding(ctx, enrollment);
  }
}

export function createStartHandler(
  logger: Logger,
): (ctx: CommandContext<BotContext>) => Promise<void> {
  return async function startHandler(ctx: CommandContext<BotContext>): Promise<void> {
    const payload = ctx.match.trim();
    const telegramId = ctx.from?.id;

    if (!payload) {
      logger.info(
        { telegramId, hasClient: Boolean(ctx.client) },
        'Получена команда /start без ссылки-приглашения',
      );
      if (ctx.client) {
        const settings = await NotificationSettings.findOne({ where: { clientId: ctx.client.id } });
        if (settings && !settings.enabled) {
          await settings.update({ enabled: true, disabledReason: null });
        }
        if (ctx.enrollment) {
          await continueSession(ctx, ctx.enrollment, false);
        } else {
          await ctx.reply(WELCOME_BACK_MESSAGE);
        }
      } else {
        await ctx.reply(AWAITING_LINK_MESSAGE);
      }
      return;
    }

    if (telegramId === undefined) {
      await ctx.reply(AWAITING_LINK_MESSAGE);
      return;
    }

    try {
      const result = await activateEnrollmentLink({
        payload,
        telegramId,
        telegramUsername: ctx.from?.username ?? null,
        logger,
      });

      if (result.success) {
        logger.info(
          {
            telegramId,
            enrollmentId: result.enrollment.id,
            clientId: result.clientId,
            onboardingStatus: result.enrollment.onboardingStatus,
            resumed: result.resumed,
          },
          result.resumed
            ? 'Повторный переход по своей ссылке-приглашению'
            : 'Ссылка-приглашение активирована',
        );
        ctx.client = result.client;
        ctx.enrollment = (await findEnrollmentForClient(result.client.id)) ?? result.enrollment;
        const isNewActivation = !result.resumed && ctx.enrollment.id === result.enrollment.id;
        await continueSession(ctx, ctx.enrollment, isNewActivation);
        return;
      }

      logger.info(
        { telegramId, error: result.error },
        'Не удалось активировать ссылку-приглашение',
      );
      await ctx.reply(ACTIVATION_ERROR_MESSAGES[result.error]);
    } catch (err) {
      logger.error({ err, telegramId }, 'Ошибка при активации ссылки-приглашения');
      await ctx.reply(INTERNAL_ERROR_MESSAGE);
    }
  };
}
