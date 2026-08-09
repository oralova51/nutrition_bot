/**
 * Генерация и сохранение ежедневной вечерней сводки (ФТ-24).
 * Вызывается из scheduler job evening-summary.
 */

import { Op } from 'sequelize';
import {
  Client,
  type DiaryStats,
  Message,
  NutritionDiary,
  type ProblemArea,
  Report,
  sendTelegramMessageWithRetry,
} from '@nutrition-bot/shared';
import { createAIEngine } from './factory.js';
import { logger } from './logger.js';

export interface BuildEveningSummaryParams {
  client: Client;
  enrollmentId: string;
  dayEntries: NutritionDiary[];
  localDate: string;
  timezone: string;
  dayRange: { start: Date; end: Date };
  /** При force повторно отправляем сообщение даже если уже было сегодня. */
  force?: boolean;
}

export interface BuildEveningSummaryResult {
  sent: boolean;
  skipped: boolean;
  reportId?: string;
  reason?: string;
}

export async function buildAndSendEveningSummary(
  params: BuildEveningSummaryParams,
): Promise<BuildEveningSummaryResult> {
  const { client, enrollmentId, dayEntries, localDate, dayRange, force = false } = params;

  if (!client.telegramId) {
    return { sent: false, skipped: true, reason: 'no_telegram' };
  }

  if (dayEntries.length === 0) {
    return { sent: false, skipped: true, reason: 'no_filled_entries' };
  }

  if (!force) {
    const alreadySent = await hasEveningSummaryToday(client.id, dayRange.start, dayRange.end);
    if (alreadySent) {
      return { sent: false, skipped: true, reason: 'already_sent' };
    }
  }

  const engine = createAIEngine();
  const summary = await engine.generateEveningSummary({
    dayEntries,
    localDate,
    clientContext: {
      firstName: client.firstName ?? null,
      timezone: params.timezone,
    },
  });

  const diaryStats = buildDayDiaryStats(dayEntries);
  const problemAreas = toProblemAreas(summary.missing);

  const existing = await Report.findOne({
    where: {
      clientEnrollmentId: enrollmentId,
      type: 'daily',
      periodStart: localDate,
    },
  });

  let report: Report;
  if (existing) {
    await existing.update({
      periodEnd: localDate,
      diaryStats,
      problemAreas,
      aiSummary: summary.summaryText,
      adherencePercent: null,
      dynamics: {},
    });
    report = existing;
  } else {
    report = await Report.create({
      clientEnrollmentId: enrollmentId,
      clientId: client.id,
      periodStart: localDate,
      periodEnd: localDate,
      type: 'daily',
      diaryStats,
      problemAreas,
      dynamics: {},
      adherencePercent: null,
      aiSummary: summary.summaryText,
    });
  }

  await sendTelegramMessageWithRetry({
    telegramId: client.telegramId,
    text: summary.summaryText,
    clientId: client.id,
    type: 'evening_summary',
    category: 'optional',
  });

  logger.info(
    {
      clientId: client.id,
      reportId: report.id,
      localDate,
      entries: dayEntries.length,
      force,
    },
    'Вечерняя сводка отправлена',
  );

  return { sent: true, skipped: false, reportId: report.id };
}

async function hasEveningSummaryToday(
  clientId: string,
  start: Date,
  end: Date,
): Promise<boolean> {
  const count = await Message.count({
    where: {
      clientId,
      type: 'evening_summary',
      createdAt: { [Op.between]: [start, end] },
    },
  });
  return count > 0;
}

function buildDayDiaryStats(entries: NutritionDiary[]): DiaryStats {
  const calories = entries
    .map((entry) => entry.approxCalories)
    .filter((value): value is number => typeof value === 'number');
  const avgCalories =
    calories.length === 0
      ? null
      : Math.round(calories.reduce((sum, value) => sum + value, 0) / calories.length);

  const topProducts = entries
    .map((entry) => entry.description?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 5);

  return {
    totalDays: 1,
    totalRecords: entries.length,
    filledEntries: entries.length,
    pendingEntries: 0,
    avgCalories,
    topProducts,
  };
}

function toProblemAreas(missing: string[]): ProblemArea[] {
  return missing.slice(0, 5).map((area) => ({ area, count: 1 }));
}
