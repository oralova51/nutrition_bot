// Сбор метрик пилота (roadmap 12.4, vision.md §6).
// Запуск: npm run pilot:metrics
// Пороги: SA/stage12-pilot.md §3. Жалобы на навязчивость — ручной ввод PILOT_NAGGING_COMPLAINTS.
// Seed-клиенты (телефон 7900120* / фамилия «Пилот-*») исключаются из расчёта.

import {
  Client,
  ClientEnrollment,
  Feedback,
  NotificationSettings,
  NutritionDiary,
  Recommendation,
  RenewalOffer,
  closeDatabaseConnection,
  getSequelize,
  initModels,
} from '@nutrition-bot/shared';
import { Op } from 'sequelize';

/** Целевые пороги пилота (согласованы на этапе 12). */
export const PILOT_TARGETS = {
  diarySharePercent: 50,
  adherencePercent: 50,
  renewalPercent: 50,
  avgFeedback: 4,
  earlyOptOutPercentMax: 20,
  naggingComplaintsMax: 2,
  cohortSize: 10,
  courseDays: 30,
} as const;

/** Клиент «ежедневно ведёт дневник», если заполнил ≥ 50% прошедших дней enrollment. */
const DIARY_ACTIVE_FILL_RATE = 50;

/** Seed-телефоны `scripts/seed-pilot.ts` — не входят в метрики реальной когорты. */
const SEED_PHONE_PREFIX = '7900120';

interface MetricResult {
  name: string;
  value: number | null;
  unit: string;
  target: string;
  pass: boolean | null;
  detail: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
}

function daysBetweenInclusive(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  return Math.max(1, Math.floor((b - a) / 86_400_000) + 1);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function minIsoDate(a: string, b: string): string {
  return a <= b ? a : b;
}

function resolveNaggingComplaints(): number {
  const raw = process.env.PILOT_NAGGING_COMPLAINTS;
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function isSeedClient(client: Pick<Client, 'phone' | 'lastName'>): boolean {
  return (
    (client.phone?.startsWith(SEED_PHONE_PREFIX) ?? false) ||
    (client.lastName?.startsWith('Пилот-') ?? false)
  );
}

async function loadPilotClientIds(): Promise<Set<string>> {
  const clients = await Client.findAll({
    attributes: ['id', 'phone', 'lastName'],
  });
  return new Set(clients.filter((c) => !isSeedClient(c)).map((c) => c.id));
}

async function computeDiaryShare(
  enrollments: ClientEnrollment[],
  pilotClientIds: Set<string>,
): Promise<{ share: number; eligible: number; active: number }> {
  const eligible = enrollments.filter(
    (e) =>
      pilotClientIds.has(e.clientId) &&
      e.onboardingStatus === 'completed' &&
      (e.status === 'active' || e.status === 'completed'),
  );
  if (eligible.length === 0) {
    return { share: 0, eligible: 0, active: 0 };
  }

  const today = todayIso();
  let activeCount = 0;

  for (const enrollment of eligible) {
    const periodEnd = minIsoDate(enrollment.endDate, today);
    const totalDays = daysBetweenInclusive(enrollment.startDate, periodEnd);
    const from = new Date(`${enrollment.startDate}T00:00:00Z`);
    const to = new Date(`${periodEnd}T23:59:59.999Z`);

    const entries = await NutritionDiary.findAll({
      where: {
        clientEnrollmentId: enrollment.id,
        mealAt: { [Op.gte]: from, [Op.lte]: to },
      },
      attributes: ['mealAt'],
    });

    const filledDays = new Set(entries.map((e) => e.mealAt.toISOString().slice(0, 10))).size;
    const fillRate = pct(filledDays, totalDays);
    if (fillRate >= DIARY_ACTIVE_FILL_RATE) {
      activeCount += 1;
    }
  }

  return {
    share: pct(activeCount, eligible.length),
    eligible: eligible.length,
    active: activeCount,
  };
}

async function computeAdherence(pilotClientIds: Set<string>): Promise<{
  percent: number;
  total: number;
  applied: number;
}> {
  if (pilotClientIds.size === 0) {
    return { percent: 0, total: 0, applied: 0 };
  }
  const recommendations = await Recommendation.findAll({
    where: { clientId: { [Op.in]: [...pilotClientIds] } },
    attributes: ['status'],
  });
  const total = recommendations.length;
  const applied = recommendations.filter((r) => r.status === 'applied').length;
  return { percent: pct(applied, total), total, applied };
}

async function computeRenewal(
  enrollments: ClientEnrollment[],
  pilotClientIds: Set<string>,
): Promise<{ percent: number; converted: number; completed: number }> {
  const completedIds = enrollments
    .filter((e) => pilotClientIds.has(e.clientId) && e.status === 'completed')
    .map((e) => e.id);

  if (completedIds.length === 0) {
    return { percent: 0, converted: 0, completed: 0 };
  }

  const converted = await RenewalOffer.count({
    where: { status: 'converted', enrollmentId: { [Op.in]: completedIds } },
  });

  return {
    percent: pct(converted, completedIds.length),
    converted,
    completed: completedIds.length,
  };
}

async function computeAvgFeedback(pilotClientIds: Set<string>): Promise<{
  avg: number | null;
  count: number;
}> {
  if (pilotClientIds.size === 0) {
    return { avg: null, count: 0 };
  }
  const feedbacks = await Feedback.findAll({
    where: {
      source: 'course_final',
      clientId: { [Op.in]: [...pilotClientIds] },
    },
    attributes: ['rating'],
  });
  if (feedbacks.length === 0) {
    return { avg: null, count: 0 };
  }
  const sum = feedbacks.reduce((acc, f) => acc + f.rating, 0);
  return { avg: round1(sum / feedbacks.length), count: feedbacks.length };
}

async function computeEarlyOptOut(
  pilotClientIds: Set<string>,
): Promise<{ percent: number; optedOut: number; base: number }> {
  if (pilotClientIds.size === 0) {
    return { percent: 0, optedOut: 0, base: 0 };
  }

  const clients = await Client.findAll({
    where: {
      id: { [Op.in]: [...pilotClientIds] },
      telegramId: { [Op.ne]: null },
    },
    attributes: ['id'],
  });
  const baseIds = clients.map((c) => c.id);
  if (baseIds.length === 0) {
    return { percent: 0, optedOut: 0, base: 0 };
  }

  const optedOut = await NotificationSettings.count({
    where: {
      clientId: { [Op.in]: baseIds },
      enabled: false,
      disabledReason: { [Op.in]: ['user_request', 'inactivity'] },
    },
  });
  return {
    percent: pct(optedOut, baseIds.length),
    optedOut,
    base: baseIds.length,
  };
}

function evaluate(metrics: MetricResult[]): {
  go: boolean;
  pending: boolean;
  failed: string[];
} {
  const failed = metrics.filter((m) => m.pass === false).map((m) => m.name);
  const pending = metrics.some((m) => m.pass === null);
  return {
    go: failed.length === 0 && !pending,
    pending: failed.length === 0 && pending,
    failed,
  };
}

async function main(): Promise<void> {
  initModels(getSequelize());

  const pilotClientIds = await loadPilotClientIds();
  const enrollments = await ClientEnrollment.findAll();

  const diary = await computeDiaryShare(enrollments, pilotClientIds);
  const adherence = await computeAdherence(pilotClientIds);
  const renewal = await computeRenewal(enrollments, pilotClientIds);
  const feedback = await computeAvgFeedback(pilotClientIds);
  const optOut = await computeEarlyOptOut(pilotClientIds);
  const nagging = resolveNaggingComplaints();

  const metrics: MetricResult[] = [
    {
      name: 'diary_daily_share',
      value: diary.share,
      unit: '%',
      target: `≥ ${PILOT_TARGETS.diarySharePercent}%`,
      pass: diary.eligible === 0 ? null : diary.share >= PILOT_TARGETS.diarySharePercent,
      detail: `${diary.active}/${diary.eligible} клиентов с fillRate ≥ ${DIARY_ACTIVE_FILL_RATE}% дней`,
    },
    {
      name: 'recommendation_adherence',
      value: adherence.percent,
      unit: '%',
      target: `≥ ${PILOT_TARGETS.adherencePercent}%`,
      pass: adherence.total === 0 ? null : adherence.percent >= PILOT_TARGETS.adherencePercent,
      detail: `${adherence.applied}/${adherence.total} рекомендаций status=applied`,
    },
    {
      name: 'renewal_rate',
      value: renewal.percent,
      unit: '%',
      target: `≥ ${PILOT_TARGETS.renewalPercent}%`,
      pass: renewal.completed === 0 ? null : renewal.percent >= PILOT_TARGETS.renewalPercent,
      detail: `${renewal.converted} converted / ${renewal.completed} completed enrollments`,
    },
    {
      name: 'avg_course_feedback',
      value: feedback.avg,
      unit: '/5',
      target: `≥ ${PILOT_TARGETS.avgFeedback}`,
      pass: feedback.avg === null ? null : feedback.avg >= PILOT_TARGETS.avgFeedback,
      detail: `n=${feedback.count}, source=course_final`,
    },
    {
      name: 'early_opt_out',
      value: optOut.percent,
      unit: '%',
      target: `≤ ${PILOT_TARGETS.earlyOptOutPercentMax}%`,
      pass: optOut.base === 0 ? null : optOut.percent <= PILOT_TARGETS.earlyOptOutPercentMax,
      detail: `${optOut.optedOut}/${optOut.base} с disabledReason user_request|inactivity`,
    },
    {
      name: 'nagging_complaints',
      value: nagging,
      unit: 'count',
      target: `≤ ${PILOT_TARGETS.naggingComplaintsMax}`,
      pass: nagging <= PILOT_TARGETS.naggingComplaintsMax,
      detail:
        'Ручной счётчик (env PILOT_NAGGING_COMPLAINTS). Жалобы на навязчивость за цикл курса.',
    },
  ];

  const verdict = evaluate(metrics);

  console.log(
    JSON.stringify(
      {
        targets: PILOT_TARGETS,
        cohortHint: `Рекомендуемый размер пилота: ${PILOT_TARGETS.cohortSize} клиентов, курс ${PILOT_TARGETS.courseDays} дней`,
        excludedSeedClients: true,
        pilotClientCount: pilotClientIds.size,
        metrics,
        verdict: {
          decision: verdict.go ? 'GO' : verdict.failed.length > 0 ? 'NO-GO' : 'PENDING',
          failed: verdict.failed,
          note: verdict.go
            ? 'Все пороги выполнены — кандидат на масштабирование (зафиксируйте в SA/stage12-pilot.md §6).'
            : verdict.failed.length > 0
              ? 'Есть провалы порогов — см. failed; решение NO-GO или доработка до повтора пилота.'
              : 'Недостаточно данных по части метрик (null pass) — дождитесь полного цикла.',
        },
      },
      null,
      2,
    ),
  );

  await closeDatabaseConnection();
}

void main().catch(async (err: unknown) => {
  console.error('Pilot metrics failed:', err);
  await closeDatabaseConnection().catch(() => undefined);
  process.exit(1);
});
