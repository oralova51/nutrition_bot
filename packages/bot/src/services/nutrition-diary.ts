// Сервис дневника питания: приём текстового описания блюда, автоопределение
// времени приёма, опциональное извлечение калорийности, сохранение в БД.
// Реализует roadmap 4.9–4.12, ФТ-5.

import { fromZonedTime, format, toZonedTime } from 'date-fns-tz';
import { Op } from 'sequelize';
import { NutritionDiary, NotificationSettings, sendTelegramMessage } from '@nutrition-bot/shared';
import type { BotContext } from '../context.js';

const CONFIRMATION_MESSAGE = 'Спасибо, записал! 🍽️';
const PHOTO_CONFIRMATION_MESSAGE = 'Спасибо, записал фото! 🍽️';
const CLARIFICATION_REQUEST_MESSAGE = 'Кажется, я не понял. Можете переформулировать?';
const CLARIFICATION_RESOLVED_MESSAGE = 'Спасибо, уточнил! 🍽️';
const CLARIFICATION_GAVE_UP_MESSAGE = 'Записал как есть. Позже мы уточним детали.';

const KEYWORD_MEAL_TIMES: Record<string, string> = {
  завтрак: '09:00',
  обед: '13:00',
  ужин: '19:00',
  перекус: '16:00',
};

interface ParsedDiaryEntry {
  description: string;
  mealAt: Date;
  approxCalories: number | null;
}

export async function handleNutritionDiaryEntry(ctx: BotContext, text: string): Promise<void> {
  const client = ctx.client;
  const enrollment = ctx.enrollment;
  if (!client?.telegramId || !enrollment) {
    await ctx.reply('У вас пока нет активного курса. Обратитесь к администратору студии.');
    return;
  }

  const timezone = await resolveClientTimezone(client.id);
  const pendingClarification = await findPendingClarification(enrollment.id, timezone);

  if (isIncompleteDescription(text)) {
    await handleIncompleteEntry(
      ctx,
      client.id,
      client.telegramId,
      enrollment.id,
      text,
      timezone,
      pendingClarification,
    );
    return;
  }

  if (pendingClarification) {
    const parsed = parseDiaryEntry(text, timezone);
    await pendingClarification.update({
      mealAt: parsed.mealAt,
      description: parsed.description,
      approxCalories: parsed.approxCalories,
      status: 'filled',
    });
    await sendClarificationResponse(
      ctx,
      client.telegramId,
      client.id,
      CLARIFICATION_RESOLVED_MESSAGE,
    );
    return;
  }

  const parsed = parseDiaryEntry(text, timezone);
  await NutritionDiary.create({
    clientEnrollmentId: enrollment.id,
    clientId: client.id,
    mealAt: parsed.mealAt,
    description: parsed.description,
    approxCalories: parsed.approxCalories,
    status: 'filled',
  });

  await sendTelegramMessage({
    telegramId: client.telegramId,
    text: CONFIRMATION_MESSAGE,
    clientId: client.id,
    type: 'info',
    category: 'optional',
  });
}

function parseDiaryEntry(text: string, timezone: string): ParsedDiaryEntry {
  let cleaned = text.trim();
  let approxCalories: number | null = null;

  const caloriesMatch = cleaned.match(/(\d+)\s*(?:ккал|калорий|кал)\b/i);
  if (caloriesMatch?.[1]) {
    approxCalories = Number.parseInt(caloriesMatch[1], 10);
    cleaned = cleaned.replace(caloriesMatch[0], '').trim();
  }

  const mealAt = parseMealTime(cleaned, timezone) ?? getCurrentZonedTime(timezone);
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return { description: cleaned, mealAt, approxCalories };
}

function parseMealTime(text: string, timezone: string): Date | null {
  const explicitTimeMatch = text.match(/\bв\s+(\d{1,2})[:.](\d{2})?\b/);
  if (explicitTimeMatch?.[1]) {
    const hours = Number.parseInt(explicitTimeMatch[1], 10);
    const minutes = explicitTimeMatch[2] ? Number.parseInt(explicitTimeMatch[2], 10) : 0;
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return buildZonedDate(timezone, hours, minutes);
    }
  }

  const lower = text.toLowerCase();
  for (const [keyword, time] of Object.entries(KEYWORD_MEAL_TIMES)) {
    if (lower.includes(keyword)) {
      const [hoursStr, minutesStr] = time.split(':');
      if (!hoursStr || !minutesStr) continue;
      const hours = Number.parseInt(hoursStr, 10);
      const minutes = Number.parseInt(minutesStr, 10);
      return buildZonedDate(timezone, hours, minutes);
    }
  }

  return null;
}

function buildZonedDate(timezone: string, hours: number, minutes: number): Date {
  const zonedNow = toZonedTime(new Date(), timezone);
  const dateString = format(zonedNow, 'yyyy-MM-dd', { timeZone: timezone });
  const localDate = new Date(
    `${dateString}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`,
  );
  return fromZonedTime(localDate, timezone);
}

function getCurrentZonedTime(timezone: string): Date {
  return fromZonedTime(toZonedTime(new Date(), timezone), timezone);
}

async function resolveClientTimezone(clientId: string): Promise<string> {
  const settings = await NotificationSettings.findOne({ where: { clientId } });
  return settings?.timezone ?? 'Europe/Moscow';
}

function isIncompleteDescription(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 3) return true;
  return !/[a-zA-Zа-яА-ЯёЁ]/.test(normalized);
}

async function findPendingClarification(
  clientEnrollmentId: string,
  timezone: string,
): Promise<NutritionDiary | null> {
  const { start, end } = getZonedDayRange(new Date(), timezone);
  return NutritionDiary.findOne({
    where: {
      clientEnrollmentId,
      status: 'needs_clarification',
      createdAt: { [Op.between]: [start, end] },
    },
    order: [['createdAt', 'DESC']],
  });
}

async function handleIncompleteEntry(
  ctx: BotContext,
  clientId: string,
  telegramId: string,
  clientEnrollmentId: string,
  text: string,
  timezone: string,
  pendingClarification: NutritionDiary | null,
): Promise<void> {
  if (pendingClarification) {
    const attempts = pendingClarification.clarificationAttempts + 1;
    const description = [pendingClarification.description, text].filter(Boolean).join('\n');
    await pendingClarification.update({
      description,
      clarificationAttempts: attempts,
    });

    if (attempts >= 3) {
      await sendClarificationResponse(ctx, telegramId, clientId, CLARIFICATION_GAVE_UP_MESSAGE);
      return;
    }

    await sendClarificationResponse(ctx, telegramId, clientId, CLARIFICATION_REQUEST_MESSAGE);
    return;
  }

  await NutritionDiary.create({
    clientEnrollmentId,
    clientId,
    mealAt: getCurrentZonedTime(timezone),
    description: text,
    approxCalories: null,
    status: 'needs_clarification',
    clarificationAttempts: 1,
  });
  await sendClarificationResponse(ctx, telegramId, clientId, CLARIFICATION_REQUEST_MESSAGE);
}

async function sendClarificationResponse(
  ctx: BotContext,
  telegramId: string,
  clientId: string,
  text: string,
): Promise<void> {
  // Подтверждение уточнения не должно ломать поток: если sendTelegramMessage недоступен,
  // fallback на ctx.reply для dev/тестов.
  try {
    await sendTelegramMessage({
      telegramId,
      text,
      clientId,
      type: 'info',
      category: 'optional',
    });
  } catch {
    await ctx.reply(text);
  }
}

function getZonedDayRange(date: Date, timezone: string): { start: Date; end: Date } {
  const zonedNow = toZonedTime(date, timezone);
  const dateString = format(zonedNow, 'yyyy-MM-dd', { timeZone: timezone });
  const startLocal = new Date(`${dateString}T00:00:00`);
  const endLocal = new Date(`${dateString}T23:59:59.999`);
  return {
    start: fromZonedTime(startLocal, timezone),
    end: fromZonedTime(endLocal, timezone),
  };
}

export async function handleNutritionDiaryPhoto(ctx: BotContext): Promise<void> {
  const client = ctx.client;
  const enrollment = ctx.enrollment;
  if (!client?.telegramId || !enrollment) {
    await ctx.reply('У вас пока нет активного курса. Обратитесь к администратору студии.');
    return;
  }

  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) {
    await ctx.reply('Не удалось получить фото. Попробуйте отправить ещё раз.');
    return;
  }

  const largestPhoto = photos[photos.length - 1];
  if (!largestPhoto) {
    await ctx.reply('Не удалось получить фото. Попробуйте отправить ещё раз.');
    return;
  }
  const fileId = largestPhoto.file_id;
  const description = ctx.message?.caption?.trim() ?? null;
  const timezone = await resolveClientTimezone(client.id);

  await NutritionDiary.create({
    clientEnrollmentId: enrollment.id,
    clientId: client.id,
    mealAt: getCurrentZonedTime(timezone),
    description,
    hasPhoto: true,
    photoRef: fileId,
    status: 'filled',
  });

  await sendTelegramMessage({
    telegramId: client.telegramId,
    text: PHOTO_CONFIRMATION_MESSAGE,
    clientId: client.id,
    type: 'info',
    category: 'optional',
  });
}
