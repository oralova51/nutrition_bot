// Обработчик настроек уведомлений: /settings и inline-кнопки.
// Реализует ФТ-3 (roadmap 3.16–3.24). Часовой пояс фиксирован (Калининград).

import type { CallbackQueryContext, CommandContext } from 'grammy';
import {
  createLogger,
  type NotificationFrequency,
  type NotificationType,
} from '@nutrition-bot/shared';
import type { BotContext } from '../context.js';
import {
  buildFrequencyKeyboard,
  buildSettingsKeyboard,
  buildTimeKeyboard,
  buildTypesKeyboard,
  formatSettingsMessage,
  getOrCreateSettings,
  TIME_SLOTS,
  toggleNotificationType,
} from '../services/notification-settings.js';
import { closeDuplicateOnboardings } from '../services/enrollment-context.js';

const logger = createLogger('bot');

const WIZARD_INTRO = 'Давайте настроим уведомления, чтобы я не беспокоил вас в неудобное время.';

const STEP_TIME_TEXT = 'Выберите время напоминания:';
const STEP_FREQUENCY_TEXT = 'Выберите частоту уведомлений:';
const STEP_TYPES_TEXT = 'Выберите типы уведомлений. Нажмите «Готово», когда закончите.';

const MIN_TYPES_MESSAGE = 'Выберите хотя бы один тип уведомлений.';

const WIZARD_DONE_SUFFIX =
  'Теперь я буду присылать напоминания по вашему расписанию (время Калининграда). Если захотите что-то поменять — отправьте /settings.';

/** Краткая памятка после онбординга: не ждать напоминаний + как писать в дневник. */
const DIARY_QUICK_GUIDE =
  'Итак, вы настроили уведомления!👍🏽\n\nТеперь давайте разберёмся, как правильно заносить данные в дневник.\n\n' +
  '📌 Краткая памятка\n\n' +
  '1. В назначенное время вам будет приходить уведомление о том, что пора записывать съеденное в дневник — но лучше записывать съеденное сразу после приёма пищи. Так легче ничего не забыть. Не ждите напоминания, пишите сразу.\n\n' +
  '2. Как писать в дневник:\n' +
  '• что съели\n' +
  '• сколько (примерно)\n' +
  '• характер: «ПП» или «с сахаром / жареное» — чтобы была понятна калорийность\n\n' +
  'Можно одним сообщением или несколькими:\n' +
  '«выпила колу без сахара 0,5 л» + «съела молочную шоколадку 100 г»\n' +
  'или: «выпила колу без сахара 0,5 л и съела молочную шоколадку 100 г»\n\n' +
  '📝Каждый вечер вам будет приходить отчёт о вашем питании за день.\n' +
  'Обратите внимание, что я не считаю калории, я просто анализирую ваше питание и количество съеденного, а также даю рекомендации по улучшению.\n\n' +
  'Маленький шаг сегодня важнее идеального плана завтра. Напишите, что уже съели — и мы начнём 🙂';

const DIARY_QUICK_GUIDE_DELAY_MS = 3_000;

/** Памятка уходит отдельным сообщением, чтобы не перекрыть «Настройки сохранены». */
function sendDiaryQuickGuideLater(ctx: BotContext): void {
  const timer = setTimeout(() => {
    void ctx.reply(DIARY_QUICK_GUIDE).catch((err: unknown) => {
      logger.error({ err }, 'Не удалось отправить памятку после онбординга');
    });
  }, DIARY_QUICK_GUIDE_DELAY_MS);
  timer.unref();
}

export async function handleSettingsCommand(ctx: CommandContext<BotContext>): Promise<void> {
  if (!ctx.client) {
    await ctx.reply(
      'У вас пока нет активного курса. Обратитесь к администратору студии — он вышлет персональную ссылку-приглашение.',
    );
    return;
  }

  const settings = await getOrCreateSettings(ctx.client.id);
  await ctx.reply(formatSettingsMessage(settings), {
    reply_markup: buildSettingsKeyboard(),
  });
}

export async function startSettingsWizard(ctx: BotContext): Promise<void> {
  if (!ctx.client) return;
  await ctx.reply(`${WIZARD_INTRO}\n\n${STEP_TIME_TEXT}`, {
    reply_markup: buildTimeKeyboard(),
  });
}

export async function handleSettingsCallback(ctx: CallbackQueryContext<BotContext>): Promise<void> {
  const callbackData = ctx.callbackQuery.data;
  if (!callbackData || !ctx.client) {
    await ctx.answerCallbackQuery();
    return;
  }

  const parts = callbackData.split(':');
  if (parts[0] !== 'settings' || parts.length < 2) {
    await ctx.answerCallbackQuery();
    return;
  }

  const action = parts[1];
  const value = parts[2] ?? '';
  const settings = await getOrCreateSettings(ctx.client.id);
  const enrollment = ctx.enrollment;
  const isWizard = enrollment?.onboardingStatus === 'settings_pending';

  switch (action) {
    case 'time': {
      const reminderTime = parts.slice(2).join(':');
      if (!TIME_SLOTS.includes(reminderTime as (typeof TIME_SLOTS)[number])) {
        await ctx.answerCallbackQuery({ text: 'Некорректное время напоминания.' });
        return;
      }
      await settings.update({ reminderTime });
      if (isWizard) {
        await ctx.editMessageText(STEP_FREQUENCY_TEXT, {
          reply_markup: buildFrequencyKeyboard(),
        });
      } else {
        await ctx.editMessageText(formatSettingsMessage(settings), {
          reply_markup: buildSettingsKeyboard(),
        });
      }
      break;
    }
    case 'freq': {
      await settings.update({ frequency: value as NotificationFrequency });
      if (isWizard) {
        await ctx.editMessageText(STEP_TYPES_TEXT, {
          reply_markup: buildTypesKeyboard(settings),
        });
      } else {
        await ctx.editMessageText(formatSettingsMessage(settings), {
          reply_markup: buildSettingsKeyboard(),
        });
      }
      break;
    }
    case 'type': {
      await toggleNotificationType(settings, value as NotificationType);
      await ctx.editMessageText(STEP_TYPES_TEXT, {
        reply_markup: buildTypesKeyboard(settings),
      });
      break;
    }
    case 'types_done': {
      if (settings.enabledTypes.length === 0) {
        await ctx.answerCallbackQuery({ text: MIN_TYPES_MESSAGE });
        return;
      }
      if (isWizard) {
        await enrollment?.update({ onboardingStatus: 'completed' });
        if (enrollment) {
          await closeDuplicateOnboardings(ctx.client.id, enrollment.id);
        }
        await ctx.editMessageText(
          `Настройки сохранены 🎉\n\n${formatSettingsMessage(settings)}\n\n${WIZARD_DONE_SUFFIX}`,
          { reply_markup: { inline_keyboard: [] } },
        );
        // Отдельным сообщением с паузой — чтобы клиент успел прочитать подтверждение настроек.
        sendDiaryQuickGuideLater(ctx);
      } else {
        await ctx.editMessageText(formatSettingsMessage(settings), {
          reply_markup: buildSettingsKeyboard(),
        });
      }
      break;
    }
    case 'edit': {
      switch (value) {
        case 'time':
          await ctx.editMessageText(STEP_TIME_TEXT, {
            reply_markup: buildTimeKeyboard(),
          });
          break;
        case 'frequency':
          await ctx.editMessageText(STEP_FREQUENCY_TEXT, {
            reply_markup: buildFrequencyKeyboard(),
          });
          break;
        case 'types':
          await ctx.editMessageText(STEP_TYPES_TEXT, {
            reply_markup: buildTypesKeyboard(settings),
          });
          break;
        default:
          await ctx.editMessageText(formatSettingsMessage(settings), {
            reply_markup: buildSettingsKeyboard(),
          });
      }
      break;
    }
    default: {
      await ctx.answerCallbackQuery();
      return;
    }
  }

  await ctx.answerCallbackQuery();
}
