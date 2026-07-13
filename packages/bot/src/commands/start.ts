// Хендлер команды /start. roadmap 2.3: заглушка «ожидаем ссылку подключения» при
// отсутствии payload. roadmap 2.4–2.6: разбор deep link с enrollment-кодом, привязка
// telegramId к ClientEnrollment и логирование попытки — см.
// services/enrollment-link-activation.ts (ФТ-1, adminAPI.md §2, §3, §5).

import type { CommandContext } from 'grammy';
import type { Logger } from 'pino';
import type { BotContext } from '../context.js';
import {
  activateEnrollmentLink,
  type ActivationErrorCode,
} from '../services/enrollment-link-activation.js';
import { startOnboarding } from '../services/onboarding.js';

const AWAITING_LINK_MESSAGE =
  'Привет! Я бот-консультант по питанию 🙂\n\n' +
  'Чтобы начать работу, мне нужна персональная ссылка-приглашение от администратора вашей студии. ' +
  'Как только она придёт — перейдите по ней, и мы продолжим отсюда.';

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
      await ctx.reply(AWAITING_LINK_MESSAGE);
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
          { telegramId, enrollmentId: result.enrollment.id, clientId: result.clientId },
          'Ссылка-приглашение активирована',
        );
        await ctx.reply(ACTIVATION_SUCCESS_MESSAGE);
        await startOnboarding(ctx, result.enrollment);
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
