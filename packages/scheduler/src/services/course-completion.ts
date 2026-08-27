// Сервис завершения курса: генерация итогового Report и отправка запроса feedback.
// Реализует roadmap 7.1–7.18, ФТ-13, ФТ-14, ФТ-15, ФТ-23.

import { format } from 'date-fns';
import { Op } from 'sequelize';
import {
  Client,
  ClientEnrollment,
  NutritionDiary,
  Recommendation,
  Report,
  getSequelize,
  sendTelegramMessageWithRetry,
  type DiaryStats,
  type ProblemArea,
  type ReportType,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';
import { sendRenewalOffer } from './course-renewal.js';

interface EnrollmentWithClient extends ClientEnrollment {
  client?: Client;
}

const PROBLEM_KEYWORDS = [
  'сладкое',
  'торт',
  'конфеты',
  'фастфуд',
  'бургер',
  'пицца',
  'перекус',
  'вечерний',
  'алкоголь',
  'вино',
  'пива',
  'ночной',
  'мучное',
  'хлеб',
  'сдоба',
];

const STOP_WORDS = new Set([
  'и',
  'в',
  'на',
  'с',
  'по',
  'к',
  'а',
  'не',
  'я',
  'что',
  'как',
  'до',
  'для',
  'за',
  'от',
  'из',
  'у',
  'же',
  'то',
  'бы',
  'ли',
  'но',
  'это',
  'так',
  'тут',
  'там',
  'при',
  'под',
  'про',
  'над',
  'без',
  'во',
  'со',
  'около',
  'после',
  'мне',
  'меня',
  'мой',
  'моя',
  'мои',
  'моё',
  'моего',
  'моей',
  'моих',
  'съел',
  'съела',
  'ела',
  'ел',
  'пила',
  'пил',
  'выпил',
  'выпила',
  'съедено',
  'поел',
  'поела',
  'завтрак',
  'обед',
  'ужин',
  'перекус',
]);

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^а-яёa-z0-9]/g, '')
    .trim();
}

export function extractTopWords(entries: NutritionDiary[], count: number): string[] {
  const frequency = new Map<string, number>();
  for (const entry of entries) {
    const text = entry.description ?? '';
    const words = text.split(/\s+/);
    for (const raw of words) {
      const word = normalizeWord(raw);
      if (word.length < 3 || STOP_WORDS.has(word)) continue;
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }
  }

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([word]) => word);
}

export function extractTopProblems(entries: NutritionDiary[], count: number): ProblemArea[] {
  const frequency = new Map<string, number>();
  for (const entry of entries) {
    const text = (entry.description ?? '').toLowerCase();
    for (const keyword of PROBLEM_KEYWORDS) {
      if (text.includes(keyword)) {
        frequency.set(keyword, (frequency.get(keyword) ?? 0) + 1);
      }
    }
  }

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([area, countValue]) => ({ area, count: countValue }));
}

export function buildMealsByHour(entries: NutritionDiary[]): Record<number, number> {
  const byHour: Record<number, number> = {};
  for (const entry of entries) {
    const hour = entry.mealAt.getUTCHours();
    byHour[hour] = (byHour[hour] ?? 0) + 1;
  }
  return byHour;
}

export function average(values: (number | null | undefined)[]): number | null {
  const valid = values.filter(
    (v): v is number => v !== null && v !== undefined && !Number.isNaN(v),
  );
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((sum, v) => sum + v, 0) / valid.length);
}

export function percentage(value: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((value / total) * 100);
}

export function countCourseDays(startDate: string, endDate: string): number {
  return Math.max(
    1,
    Math.ceil(
      (new Date(`${endDate}T00:00:00.000Z`).getTime() -
        new Date(`${startDate}T00:00:00.000Z`).getTime()) /
        (1000 * 60 * 60 * 24),
    ) + 1,
  );
}

export function generateAiSummary(stats: DiaryStats): string {
  const days = stats.totalDays ?? 0;
  const records = stats.totalRecords ?? 0;
  const filled = stats.filledEntries ?? 0;

  let summary =
    'Спасибо за сотрудничество! Вот как я могу подытожить результаты питания во время курса:\n\n';
  summary += `• Дней курса: ${days}, записей в дневнике: ${records} (заполнено: ${filled}).\n`;
  if (typeof stats.avgCalories === 'number') {
    summary += `• Средняя калорийность: ${stats.avgCalories} ккал/день.\n`;
  }

  if (stats.topProducts && stats.topProducts.length > 0) {
    summary += `• Чаще всего встречалось: ${stats.topProducts.slice(0, 5).join(', ')}.\n`;
  }

  if (stats.topProblems && stats.topProblems.length > 0) {
    summary += `• Обратите внимание: ${stats.topProblems.slice(0, 5).join(', ')}.\n`;
  }

  summary +=
    '\nВы проделали большую работу. Помните: устойчивые изменения приходят постепенно, и каждая запись — шаг вперёд. 💚';
  return summary;
}

export function formatReportMessage(report: Report): string {
  const stats = report.diaryStats;
  const lines = [
    '<b>🎉 Курс завершён!</b>',
    '',
    '<b>Итоговый отчёт о питании</b>',
    `Период: ${report.periodStart} — ${report.periodEnd}`,
    '',
    `📊 Дней курса: ${stats.totalDays ?? 0}, записей: ${stats.totalRecords ?? 0} (заполнено: ${stats.filledEntries ?? 0})`,
  ];

  if (typeof stats.avgCalories === 'number') {
    lines.push(`🔥 Средняя калорийность: ${stats.avgCalories} ккал/день`);
  }

  lines.push('');

  if (stats.topProducts && stats.topProducts.length > 0) {
    lines.push(`🍽 Топ-5 продуктов: ${escapeHtml(stats.topProducts.join(', '))}`);
  }

  if (report.problemAreas && report.problemAreas.length > 0) {
    const problems = report.problemAreas.map((p) => escapeHtml(p.area)).join(', ');
    lines.push(`⚠️ Топ-5 проблем: ${problems}`);
  }

  if (report.aiSummary) {
    lines.push('');
    lines.push(report.aiSummary);
  }

  return lines.join('\n');
}

async function findEnrollmentsToComplete(
  today: string,
  options: { clientId?: string; force?: boolean } = {},
): Promise<ClientEnrollment[]> {
  const where: Record<string, unknown> = {
    status: 'active',
    onboardingStatus: 'completed',
  };

  // force + clientId: симуляция конца курса до endDate (ручной тест через Postman).
  // Без clientId (и в cron) — только enrollment'ы с наступившим endDate.
  if (options.force === true && options.clientId) {
    where.clientId = options.clientId;
  } else {
    where.endDate = { [Op.lte]: today };
    if (options.clientId) {
      where.clientId = options.clientId;
    }
  }

  return ClientEnrollment.findAll({
    where,
    include: [
      {
        model: Client,
        as: 'client',
        required: true,
        where: { telegramId: { [Op.ne]: null } },
      },
    ],
  });
}

export function getEnrollmentPeriodBounds(enrollment: ClientEnrollment): {
  start: Date;
  end: Date;
} {
  return {
    start: new Date(`${enrollment.startDate}T00:00:00.000Z`),
    end: new Date(`${enrollment.endDate}T23:59:59.999Z`),
  };
}

export async function buildFinalReport(
  enrollment: ClientEnrollment,
  type: ReportType = 'final',
): Promise<Report> {
  const existing = await Report.findOne({
    where: { clientEnrollmentId: enrollment.id, type: 'final' },
  });
  if (existing) {
    return existing;
  }

  const { start, end } = getEnrollmentPeriodBounds(enrollment);

  const entries = await NutritionDiary.findAll({
    where: {
      clientEnrollmentId: enrollment.id,
      mealAt: { [Op.between]: [start, end] },
    },
    order: [['mealAt', 'ASC']],
  });

  const filled = entries.filter((e) => e.status === 'filled');
  const pending = entries.filter((e) => e.status === 'pending');
  const totalDays = countCourseDays(enrollment.startDate, enrollment.endDate);

  const diaryStats: DiaryStats = {
    avgCalories: average(filled.map((e) => e.approxCalories)),
    avgProtein: null,
    avgFat: null,
    avgCarbs: null,
    totalDays,
    totalRecords: entries.length,
    filledEntries: filled.length,
    pendingEntries: pending.length,
    mealsByHour: buildMealsByHour(filled),
    topProducts: extractTopWords(filled, 5),
    topProblems: extractTopProblems(filled, 5).map((p) => p.area),
  };

  const recommendations = await Recommendation.findAll({
    where: {
      clientId: enrollment.clientId,
      createdAt: { [Op.between]: [start, end] },
    },
  });
  const appliedCount = recommendations.filter((r) => r.status === 'applied').length;
  const adherencePercent = percentage(appliedCount, recommendations.length);

  const problemAreas = extractTopProblems(filled, 5);

  const dynamics = {
    calorieTrend: null,
    adherenceTrend: null,
  };

  const aiSummary = generateAiSummary(diaryStats);

  const sequelize = getSequelize();
  return sequelize.transaction(async (transaction) => {
    const report = await Report.create(
      {
        clientEnrollmentId: enrollment.id,
        clientId: enrollment.clientId,
        periodStart: enrollment.startDate,
        periodEnd: enrollment.endDate,
        type,
        diaryStats,
        adherencePercent,
        problemAreas,
        dynamics,
        aiSummary,
      },
      { transaction },
    );

    await enrollment.update({ status: 'completed' }, { transaction });

    return report;
  });
}

async function sendReportToTelegram(
  enrollment: EnrollmentWithClient,
  report: Report,
): Promise<void> {
  const client = enrollment.client;
  if (!client?.telegramId) return;

  await sendTelegramMessageWithRetry({
    telegramId: client.telegramId,
    text: formatReportMessage(report),
    clientId: client.id,
    type: 'report',
    category: 'transactional',
    parseMode: 'HTML',
  });
}

export function buildFeedbackKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '1 ⭐', callback_data: 'feedback:stars:1' },
        { text: '2 ⭐', callback_data: 'feedback:stars:2' },
        { text: '3 ⭐', callback_data: 'feedback:stars:3' },
        { text: '4 ⭐', callback_data: 'feedback:stars:4' },
        { text: '5 ⭐', callback_data: 'feedback:stars:5' },
      ],
    ],
  };
}

async function requestFeedback(enrollment: EnrollmentWithClient): Promise<void> {
  const client = enrollment.client;
  if (!client?.telegramId) return;

  const text =
    'Оцени, насколько полезными для тебя были мои рекомендации?\n\n' +
    'Нажми на звёздочку ниже — это займёт секунду.';

  await sendTelegramMessageWithRetry({
    telegramId: client.telegramId,
    text,
    clientId: client.id,
    type: 'feedback_request',
    category: 'transactional',
    parseMode: 'HTML',
    replyMarkup: buildFeedbackKeyboard(),
  });
}

export async function completeCourse(enrollment: ClientEnrollment, logger: Logger): Promise<void> {
  const enrollmentWithClient = enrollment as EnrollmentWithClient;
  const client = enrollmentWithClient.client;
  if (!client?.telegramId) {
    logger.info(
      { enrollmentId: enrollment.id },
      'Enrollment без привязанного telegramId, пропускаем завершение',
    );
    return;
  }

  const report = await buildFinalReport(enrollment);
  await sendReportToTelegram(enrollmentWithClient, report);
  await requestFeedback(enrollmentWithClient);
  await sendRenewalOffer(enrollment, logger);

  logger.info(
    { enrollmentId: enrollment.id, clientId: enrollment.clientId, reportId: report.id },
    'Курс завершён, отчёт, запрос feedback и предложение продления отправлены',
  );
}

export async function findAndCompleteCourses(
  logger: Logger,
  options: { clientId?: string; force?: boolean } = {},
): Promise<{ considered: number; sent: number; skipped: number; errors: number }> {
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');

  const enrollments = await findEnrollmentsToComplete(today, options);
  logger.info(
    {
      count: enrollments.length,
      today,
      force: options.force === true,
      clientId: options.clientId ?? null,
    },
    "Найдено enrollment'ов для завершения курса",
  );

  const result = {
    considered: enrollments.length,
    sent: 0,
    skipped: 0,
    errors: 0,
  };

  for (const enrollment of enrollments) {
    try {
      await completeCourse(enrollment, logger);
      result.sent += 1;
    } catch (err) {
      result.errors += 1;
      logger.error(
        { enrollmentId: enrollment.id, err },
        'Не удалось завершить курс для enrollment',
      );
    }
  }

  return result;
}
