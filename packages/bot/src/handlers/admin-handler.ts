// Telegram-админка для пилота: /admin + inline-кнопки.
// Доступ только по ADMIN_ALERT_TELEGRAM_ID. Флоу: создать курс / пригласить клиента
// (клиент + enrollment + deep link) — без ломки admin API.

import type { CallbackQueryContext, CommandContext, NextFunction } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../context.js';
import { isAdminTelegramUser, resolveAdminTelegramId } from '../services/admin-auth.js';
import {
  clearAdminSession,
  getAdminSession,
  setAdminSession,
} from '../services/admin-session.js';
import {
  createCourseByDays,
  inviteClient,
  listCoursesForAdmin,
  parseClientName,
  parseDurationDays,
} from '../services/admin-ops.js';

const ACCESS_DENIED = 'Недостаточно прав.';
const NOT_CONFIGURED =
  'Админ-панель не настроена: задайте ADMIN_ALERT_TELEGRAM_ID в окружении бота.';

const MENU_TEXT =
  'Админ-панель\n\n' +
  '• «Пригласить клиента» — выбрать курс, ввести имя, получить ссылку.\n' +
  '• «Создать курс» — указать длительность в днях.';

const CANCEL_HINT = 'Отмена — кнопка ниже или /admin.';

function buildMainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .row(InlineKeyboard.text('Пригласить клиента', 'admin:invite'))
    .row(InlineKeyboard.text('Создать курс', 'admin:create_course'));
}

function buildCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().row(InlineKeyboard.text('Отмена', 'admin:cancel'));
}

async function buildCoursePickerKeyboard(): Promise<InlineKeyboard | null> {
  const courses = await listCoursesForAdmin();
  if (courses.length === 0) {
    return null;
  }

  const keyboard = new InlineKeyboard();
  for (const course of courses) {
    const label = `${course.name} (${course.durationDays} дн.)`;
    keyboard.row(InlineKeyboard.text(label.slice(0, 64), `admin:invite:course:${course.id}`));
  }
  keyboard.row(InlineKeyboard.text('Отмена', 'admin:cancel'));
  return keyboard;
}

function requireAdmin(ctx: BotContext): boolean {
  return isAdminTelegramUser(ctx.from?.id);
}

function adminTelegramKey(ctx: BotContext): string | undefined {
  const id = ctx.from?.id;
  return id === undefined ? undefined : String(id);
}

export async function handleAdminCommand(ctx: CommandContext<BotContext>): Promise<void> {
  if (!resolveAdminTelegramId()) {
    await ctx.reply(NOT_CONFIGURED);
    return;
  }

  if (!requireAdmin(ctx)) {
    await ctx.reply(ACCESS_DENIED);
    return;
  }

  const key = adminTelegramKey(ctx);
  if (key) {
    clearAdminSession(key);
  }

  await ctx.reply(MENU_TEXT, { reply_markup: buildMainMenuKeyboard() });
}

export async function handleAdminCallback(ctx: CallbackQueryContext<BotContext>): Promise<void> {
  const data = ctx.callbackQuery.data;
  if (!data?.startsWith('admin:')) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (!resolveAdminTelegramId()) {
    await ctx.answerCallbackQuery({ text: 'Админ не настроен' });
    await ctx.reply(NOT_CONFIGURED);
    return;
  }

  if (!requireAdmin(ctx)) {
    await ctx.answerCallbackQuery({ text: 'Нет доступа' });
    await ctx.reply(ACCESS_DENIED);
    return;
  }

  const key = adminTelegramKey(ctx);
  if (!key) {
    await ctx.answerCallbackQuery();
    return;
  }

  const parts = data.split(':');

  if (parts[1] === 'cancel') {
    clearAdminSession(key);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Отменено.\n\n' + MENU_TEXT, {
      reply_markup: buildMainMenuKeyboard(),
    });
    return;
  }

  if (parts[1] === 'create_course') {
    setAdminSession(key, { step: 'awaiting_course_days' });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      'Создание курса\n\nВведите длительность в днях (целое число от 1 до 365).\n\n' +
        CANCEL_HINT,
      { reply_markup: buildCancelKeyboard() },
    );
    return;
  }

  if (parts[1] === 'invite' && parts[2] === undefined) {
    const keyboard = await buildCoursePickerKeyboard();
    await ctx.answerCallbackQuery();
    if (!keyboard) {
      clearAdminSession(key);
      await ctx.editMessageText(
        'Нет курсов. Сначала создайте курс («Создать курс»), затем пригласите клиента.',
        { reply_markup: buildMainMenuKeyboard() },
      );
      return;
    }
    await ctx.editMessageText('Выберите курс для клиента:', { reply_markup: keyboard });
    return;
  }

  if (parts[1] === 'invite' && parts[2] === 'course' && parts[3]) {
    const courseId = parts[3];
    setAdminSession(key, { step: 'awaiting_client_name', courseId });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      'Введите имя клиента.\n' +
        'Можно одной строкой: «Анна» или «Анна Иванова».\n\n' +
        CANCEL_HINT,
      { reply_markup: buildCancelKeyboard() },
    );
    return;
  }

  await ctx.answerCallbackQuery();
}

/**
 * Перехватывает текст админа в середине диалога (дни / имя).
 * Возвращает true, если сообщение обработано и дальше его не нужно отдавать клиентским хендлерам.
 */
export async function tryHandleAdminText(ctx: BotContext): Promise<boolean> {
  const key = adminTelegramKey(ctx);
  if (!key || !requireAdmin(ctx)) {
    return false;
  }

  const session = getAdminSession(key);
  if (!session) {
    return false;
  }

  const rawText = ctx.message?.text ?? '';
  if (rawText.startsWith('/')) {
    // Команды (/admin и др.) обрабатываются своими хендлерами.
    return false;
  }

  const text = rawText.trim();

  if (session.step === 'awaiting_course_days') {
    const days = parseDurationDays(text);
    if (days === null) {
      await ctx.reply('Нужно целое число дней от 1 до 365. Попробуйте ещё раз.', {
        reply_markup: buildCancelKeyboard(),
      });
      return true;
    }

    try {
      const course = await createCourseByDays(days);
      clearAdminSession(key);
      await ctx.reply(
        `Курс создан.\n\n` +
          `Название: ${course.name}\n` +
          `Длительность: ${course.durationDays} дн.\n` +
          `Период шаблона: ${course.startDate} — ${course.endDate}\n` +
          `id: ${course.id}`,
        { reply_markup: buildMainMenuKeyboard() },
      );
    } catch (err) {
      clearAdminSession(key);
      await ctx.reply(`Не удалось создать курс: ${String(err)}`, {
        reply_markup: buildMainMenuKeyboard(),
      });
    }
    return true;
  }

  if (session.step === 'awaiting_client_name') {
    const name = parseClientName(text);
    if (!name) {
      await ctx.reply('Введите непустое имя (например, «Анна Иванова»).', {
        reply_markup: buildCancelKeyboard(),
      });
      return true;
    }

    try {
      const result = await inviteClient({
        firstName: name.firstName,
        lastName: name.lastName,
        courseId: session.courseId,
      });
      clearAdminSession(key);

      const displayName =
        result.client.lastName === '-'
          ? result.client.firstName
          : `${result.client.firstName} ${result.client.lastName}`;

      await ctx.reply(
        `Клиент приглашён.\n\n` +
          `Имя: ${displayName}\n` +
          `Курс: ${result.course.name}\n` +
          `Enrollment: ${result.enrollment.startDate} — ${result.enrollment.endDate}\n` +
          `Ссылка действует до: ${result.linkExpiresAt.toISOString().slice(0, 10)}\n\n` +
          `${result.linkUrl}`,
        { reply_markup: buildMainMenuKeyboard() },
      );
    } catch (err) {
      clearAdminSession(key);
      const message =
        err instanceof Error && err.message === 'COURSE_NOT_FOUND'
          ? 'Курс не найден. Создайте курс или выберите другой.'
          : `Не удалось пригласить клиента: ${String(err)}`;
      await ctx.reply(message, { reply_markup: buildMainMenuKeyboard() });
    }
    return true;
  }

  return false;
}

/** Middleware: админский ввод имени/дней имеет приоритет над клиентским текстом. */
export async function adminTextMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  if (await tryHandleAdminText(ctx)) {
    return;
  }
  await next();
}
