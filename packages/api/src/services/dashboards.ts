// Dashboard-эндпоинты для администратора и специалиста (roadmap 9.4–9.9, 9.12–9.16).
// См. SA/stage9-dashboards.md для контрактов и Postman-коллекции.

import {
  Client,
  ClientEnrollment,
  Course,
  Feedback,
  Message,
  NutritionDiary,
  Questionnaire,
  Recommendation,
  Report,
  RenewalOffer,
  type ClientEnrollmentStatus,
  type NutritionDiaryStatus,
  type OnboardingStatus,
  type RecommendationPriority,
  type RecommendationStatus,
  type ReportType,
  type RenewalOfferStatus,
} from '@nutrition-bot/shared';
import { Op } from 'sequelize';
import { ApiError } from '../http.js';
import { displayName, escapeCsvCell, pickCurrentEnrollment } from '../utils.js';
import { type PaginationParams } from '../validation.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type ClientWithEnrollments = Client & { enrollments?: ClientEnrollment[] };
type FeedbackWithClient = Feedback & { client?: Client };
type RenewalOfferWithClient = RenewalOffer & { client?: Client };
type MessageWithClient = Message & { client?: Client };
type RecommendationWithSources = Recommendation & {
  nutritionDiary?: NutritionDiary;
  questionnaire?: Questionnaire;
};

function dateToUtcStart(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateToUtcEnd(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function dateRangeFilter(
  range: { from?: string; to?: string },
  buildDate: (value: string) => Date,
): { [Op.gte]?: Date; [Op.lte]?: Date } | undefined {
  if (!range.from && !range.to) {
    return undefined;
  }
  const filter: { [Op.gte]?: Date; [Op.lte]?: Date } = {};
  if (range.from) {
    filter[Op.gte] = buildDate(range.from);
  }
  if (range.to) {
    filter[Op.lte] = buildDate(range.to);
  }
  return filter;
}

function createdAtFilter(range: {
  from?: string;
  to?: string;
}): { [Op.gte]?: Date; [Op.lte]?: Date } | undefined {
  return dateRangeFilter(range, dateToUtcStart);
}

function mealAtFilter(range: {
  from?: string;
  to?: string;
}): { [Op.gte]?: Date; [Op.lte]?: Date } | undefined {
  return dateRangeFilter(range, dateToUtcStart);
}

// ---------- 9.4 Просмотр дневника (анонимизированно) ----------

export interface DiaryEntryView {
  id: string;
  mealAt: string;
  description: string | null;
  approxCalories: number | null;
  hasPhoto: boolean;
  photoRef: string | null;
  status: NutritionDiaryStatus;
}

export interface DiaryListResult {
  data: DiaryEntryView[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function listEnrollmentDiary(
  enrollmentId: string,
  filters: { status?: NutritionDiaryStatus; from?: string; to?: string },
  pagination: PaginationParams,
): Promise<DiaryListResult> {
  const enrollment = await ClientEnrollment.findByPk(enrollmentId);
  if (!enrollment) {
    throw new ApiError(
      404,
      'ENROLLMENT_NOT_FOUND',
      `ClientEnrollment with id '${enrollmentId}' not found`,
    );
  }

  const where: Record<string, unknown> = { clientEnrollmentId: enrollmentId };
  if (filters.status) {
    where.status = filters.status;
  }
  const mealFilter = mealAtFilter(filters);
  if (mealFilter) {
    where.mealAt = mealFilter;
  }

  const { rows, count } = await NutritionDiary.findAndCountAll({
    where,
    order: [['mealAt', 'DESC']],
    limit: pagination.limit,
    offset: (pagination.page - 1) * pagination.limit,
  });

  const data = rows.map((entry) => ({
    id: entry.id,
    mealAt: entry.mealAt.toISOString(),
    description: entry.description,
    approxCalories: entry.approxCalories,
    hasPhoto: entry.hasPhoto,
    photoRef: entry.photoRef,
    status: entry.status,
  }));

  const totalPages = count === 0 ? 0 : Math.ceil(count / pagination.limit);

  return {
    data,
    pagination: { page: pagination.page, limit: pagination.limit, total: count, totalPages },
  };
}

// ---------- 9.5 Статистика соблюдения рекомендаций ----------

export interface RecommendationsStatsView {
  total: number;
  byStatus: Record<RecommendationStatus, number>;
  adherencePercent: number;
  byPriority: Record<RecommendationPriority, { total: number; applied: number }>;
}

export async function getRecommendationsStatistics(filters: {
  courseId?: string;
  from?: string;
  to?: string;
}): Promise<RecommendationsStatsView> {
  if (filters.courseId) {
    const course = await Course.findByPk(filters.courseId);
    if (!course) {
      throw new ApiError(404, 'COURSE_NOT_FOUND', `Course with id '${filters.courseId}' not found`);
    }
  }

  const where: Record<string, unknown> = {};
  const dateFilter = createdAtFilter(filters);
  if (dateFilter) {
    where.createdAt = dateFilter;
  }

  if (filters.courseId) {
    const enrollments = await ClientEnrollment.findAll({
      where: { courseId: filters.courseId },
      attributes: ['clientId'],
    });
    const clientIds = [...new Set(enrollments.map((e) => e.clientId))];
    if (clientIds.length === 0) {
      return buildRecommendationsStatsView([]);
    }
    where.clientId = { [Op.in]: clientIds };
  }

  const recommendations = await Recommendation.findAll({ where });
  return buildRecommendationsStatsView(recommendations);
}

function buildRecommendationsStatsView(
  recommendations: Recommendation[],
): RecommendationsStatsView {
  const total = recommendations.length;

  const byStatus: Record<RecommendationStatus, number> = {
    sent: 0,
    read: 0,
    applied: 0,
    dismissed: 0,
  };
  for (const r of recommendations) {
    byStatus[r.status as RecommendationStatus] += 1;
  }

  const byPriority: Record<RecommendationPriority, { total: number; applied: number }> = {
    critical: { total: 0, applied: 0 },
    high: { total: 0, applied: 0 },
    medium: { total: 0, applied: 0 },
    low: { total: 0, applied: 0 },
  };
  for (const r of recommendations) {
    byPriority[r.priority].total += 1;
    if (r.status === 'applied') {
      byPriority[r.priority].applied += 1;
    }
  }

  const adherencePercent = total === 0 ? 0 : Math.round((byStatus.applied / total) * 100);

  return { total, byStatus, adherencePercent, byPriority };
}

// ---------- 9.6 Inbox критической обратной связи ----------

export interface CriticalFeedbackView {
  feedbackId: string;
  clientDisplayName: string;
  clientId: string;
  enrollmentId: string | null;
  rating: number;
  comment: string | null;
  source: string;
  createdAt: string;
  isResolved: boolean;
}

export interface CriticalFeedbackListResult {
  data: CriticalFeedbackView[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function listCriticalFeedback(
  filters: { unresolvedOnly?: boolean },
  pagination: PaginationParams,
): Promise<CriticalFeedbackListResult> {
  const where: Record<string, unknown> = { rating: { [Op.lte]: 3 } };
  if (filters.unresolvedOnly) {
    where.isResolved = false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const { rows, count } = (await Feedback.findAndCountAll({
    where,
    include: [{ model: Client, as: 'client' }],
    order: [['createdAt', 'DESC']],
    limit: pagination.limit,
    offset: (pagination.page - 1) * pagination.limit,
  })) as unknown as { rows: FeedbackWithClient[]; count: number };

  const recommendationIds = [
    ...new Set(rows.map((f) => f.recommendationId).filter((id): id is string => id !== null)),
  ];

  const recommendations =
    recommendationIds.length > 0
      ? ((await Recommendation.findAll({
          where: { id: { [Op.in]: recommendationIds } },
          include: [
            { model: NutritionDiary, as: 'nutritionDiary', attributes: ['clientEnrollmentId'] },
            { model: Questionnaire, as: 'questionnaire', attributes: ['clientEnrollmentId'] },
          ],
        })) as unknown as RecommendationWithSources[])
      : [];

  const recommendationMap = new Map(recommendations.map((r) => [r.id, r]));

  const fallbackClientIds = [
    ...new Set(rows.filter((f) => !f.recommendationId).map((f) => f.clientId)),
  ];

  const fallbackEnrollments =
    fallbackClientIds.length > 0
      ? await ClientEnrollment.findAll({
          where: { clientId: { [Op.in]: fallbackClientIds } },
        })
      : [];

  const enrollmentsByClient = new Map<string, ClientEnrollment[]>();
  for (const enrollment of fallbackEnrollments) {
    const list = enrollmentsByClient.get(enrollment.clientId) ?? [];
    list.push(enrollment);
    enrollmentsByClient.set(enrollment.clientId, list);
  }

  const data = rows.map((feedback) => {
    const client = feedback.client;
    let enrollmentId: string | null = null;
    if (feedback.recommendationId) {
      const recommendation = recommendationMap.get(feedback.recommendationId);
      enrollmentId =
        recommendation?.nutritionDiary?.clientEnrollmentId ??
        recommendation?.questionnaire?.clientEnrollmentId ??
        null;
    }
    if (!enrollmentId) {
      enrollmentId =
        pickCurrentEnrollment(enrollmentsByClient.get(feedback.clientId) ?? [])?.id ?? null;
    }
    return {
      feedbackId: feedback.id,
      clientDisplayName: client ? displayName(client.firstName, client.lastName) : '',
      clientId: feedback.clientId,
      enrollmentId,
      rating: feedback.rating,
      comment: feedback.comment,
      source: feedback.source,
      createdAt: feedback.createdAt.toISOString(),
      isResolved: feedback.isResolved,
    };
  });

  const totalPages = count === 0 ? 0 : Math.ceil(count / pagination.limit);

  return {
    data,
    pagination: { page: pagination.page, limit: pagination.limit, total: count, totalPages },
  };
}

// ---------- 9.7 Предложения продления ----------

export interface RenewalOfferView {
  offerId: string;
  clientDisplayName: string;
  clientId: string;
  enrollmentId: string;
  status: RenewalOfferStatus;
  basePrice: number;
  discountPercent: number;
  finalPrice: number;
  offeredAt: string;
  clickedAt: string | null;
}

export interface RenewalOfferListResult {
  data: RenewalOfferView[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  summary: {
    sent: number;
    clicked: number;
    converted: number;
    dismissed: number;
    conversionPercent: number;
  };
}

export async function listRenewalOffers(
  filters: { status?: RenewalOfferStatus },
  pagination: PaginationParams,
): Promise<RenewalOfferListResult> {
  const where: Record<string, unknown> = {};
  if (filters.status) {
    where.status = filters.status;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const { rows, count } = (await RenewalOffer.findAndCountAll({
    where,
    include: [{ model: Client, as: 'client' }],
    order: [['offeredAt', 'DESC']],
    limit: pagination.limit,
    offset: (pagination.page - 1) * pagination.limit,
  })) as unknown as { rows: RenewalOfferWithClient[]; count: number };

  const data = rows.map((offer) => {
    const client = offer.client;
    return {
      offerId: offer.id,
      clientDisplayName: client ? displayName(client.firstName, client.lastName) : '',
      clientId: offer.clientId,
      enrollmentId: offer.enrollmentId,
      status: offer.status,
      basePrice: offer.basePrice,
      discountPercent: offer.discountPercent,
      finalPrice: offer.finalPrice,
      offeredAt: offer.offeredAt.toISOString(),
      clickedAt: offer.clickedAt ? offer.clickedAt.toISOString() : null,
    };
  });

  const totalPages = count === 0 ? 0 : Math.ceil(count / pagination.limit);

  const allOffers = await RenewalOffer.findAll({ attributes: ['status'] });
  const summary = {
    sent: 0,
    clicked: 0,
    converted: 0,
    dismissed: 0,
    conversionPercent: 0,
  };
  for (const offer of allOffers) {
    summary[offer.status as RenewalOfferStatus] += 1;
  }
  summary.conversionPercent =
    summary.sent === 0 ? 0 : Math.round((summary.converted / summary.sent) * 100);

  return {
    data,
    pagination: { page: pagination.page, limit: pagination.limit, total: count, totalPages },
    summary,
  };
}

// ---------- 9.8 Экспорт CSV ----------

export interface CsvExportInput {
  status?: 'active' | 'inactive' | 'all';
  enrollmentStatus?: ClientEnrollmentStatus;
  onboardingStatus?: OnboardingStatus;
}

export async function exportClientsCsv(
  input: CsvExportInput,
  botUsername: string,
): Promise<{ filename: string; content: string }> {
  // CSV экспортирует всех клиентов, удовлетворяющих фильтрам —
  // для объёма одной студии в MVP пагинация не нужна (nonFR §4).
  const { listClients } = await import('./clients.js');

  const result = await listClients(
    {
      status: input.status,
      enrollmentStatus: input.enrollmentStatus,
      onboardingStatus: input.onboardingStatus,
      sort: 'registeredAt',
      order: 'desc',
    },
    null,
    botUsername,
  );

  const rows = [
    [
      'clientId',
      'displayName',
      'enrollmentStatus',
      'onboardingStatus',
      'notificationsEnabled',
      'linkStatus',
      'lastInteractionAt',
      'registeredAt',
    ],
    ...result.data.map((client) => [
      client.id,
      client.displayName,
      client.enrollment?.status ?? '',
      client.onboarding.status ?? '',
      String(client.notifications.enabled),
      client.link?.status ?? 'no_link',
      client.lastInteractionAt ?? '',
      client.registeredAt,
    ]),
  ];

  const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');

  const date = new Date().toISOString().slice(0, 10);
  return { filename: `clients-${date}.csv`, content: `\uFEFF${csv}` };
}

// ---------- 9.9 Недоставленные сообщения ----------

export interface FailedMessageView {
  messageId: string;
  clientDisplayName: string;
  clientId: string;
  type: string;
  content: string;
  deliveryStatus: string;
  retryCount: number;
  createdAt: string;
}

export interface FailedMessageListResult {
  data: FailedMessageView[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function listFailedMessages(
  filters: { exhaustedRetries?: boolean },
  pagination: PaginationParams,
): Promise<FailedMessageListResult> {
  const where: Record<string, unknown> = { deliveryStatus: 'delivery_failed' };
  if (filters.exhaustedRetries) {
    where.retryCount = 3;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const { rows, count } = (await Message.findAndCountAll({
    where,
    include: [{ model: Client, as: 'client' }],
    order: [['createdAt', 'DESC']],
    limit: pagination.limit,
    offset: (pagination.page - 1) * pagination.limit,
  })) as unknown as { rows: MessageWithClient[]; count: number };

  const data = rows.map((message) => {
    const client = message.client;
    return {
      messageId: message.id,
      clientDisplayName: client ? displayName(client.firstName, client.lastName) : '',
      clientId: message.clientId,
      type: message.type,
      content: message.content,
      deliveryStatus: message.deliveryStatus,
      retryCount: message.retryCount,
      createdAt: message.createdAt.toISOString(),
    };
  });

  const totalPages = count === 0 ? 0 : Math.ceil(count / pagination.limit);

  return {
    data,
    pagination: { page: pagination.page, limit: pagination.limit, total: count, totalPages },
  };
}

// ---------- 9.12 Итоговые отчёты специалиста ----------

export interface ReportView {
  reportId: string;
  enrollmentId: string;
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  adherencePercent: number | null;
  diaryStats: {
    totalRecords?: number;
    filledEntries?: number;
    pendingEntries?: number;
    avgCalories?: number | null;
  };
  problemAreas: { area: string; count: number }[];
  dynamics: {
    adherenceTrend?: 'up' | 'down' | 'stable' | null;
  };
  aiSummary: string | null;
}

export interface ReportListResult {
  data: ReportView[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function listClientReports(
  clientId: string,
  filters: { type?: ReportType },
  pagination: PaginationParams,
): Promise<ReportListResult> {
  const client = await Client.findByPk(clientId);
  if (!client) {
    throw new ApiError(404, 'CLIENT_NOT_FOUND', `Client with id '${clientId}' not found`);
  }

  const where: Record<string, unknown> = { clientId };
  if (filters.type) {
    where.type = filters.type;
  }

  const { rows, count } = await Report.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: pagination.limit,
    offset: (pagination.page - 1) * pagination.limit,
  });

  const data = rows.map((report) => ({
    reportId: report.id,
    enrollmentId: report.clientEnrollmentId,
    type: report.type,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    adherencePercent: report.adherencePercent,
    diaryStats: {
      totalRecords: report.diaryStats.totalRecords,
      filledEntries: report.diaryStats.filledEntries,
      pendingEntries: report.diaryStats.pendingEntries,
      avgCalories: report.diaryStats.avgCalories,
    },
    problemAreas: report.problemAreas,
    dynamics: {
      adherenceTrend: report.dynamics.adherenceTrend,
    },
    aiSummary: report.aiSummary,
  }));

  const totalPages = count === 0 ? 0 : Math.ceil(count / pagination.limit);

  return {
    data,
    pagination: { page: pagination.page, limit: pagination.limit, total: count, totalPages },
  };
}

// ---------- 9.13 Соблюдение рекомендаций по клиенту ----------

export interface ComplianceView {
  clientId: string;
  enrollmentId: string | null;
  totalRecommendations: number;
  applied: number;
  read: number;
  dismissed: number;
  adherencePercent: number;
}

export async function getClientCompliance(clientId: string): Promise<ComplianceView> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const client = (await Client.findByPk(clientId, {
    include: [{ model: ClientEnrollment, as: 'enrollments' }],
  })) as unknown as ClientWithEnrollments | null;
  if (!client) {
    throw new ApiError(404, 'CLIENT_NOT_FOUND', `Client with id '${clientId}' not found`);
  }

  const enrollments = client.enrollments ?? [];
  const currentEnrollment = pickCurrentEnrollment(enrollments);

  let recommendations: Recommendation[] = [];
  if (currentEnrollment) {
    recommendations = await Recommendation.findAll({
      where: {
        clientId,
        createdAt: {
          [Op.gte]: dateToUtcStart(currentEnrollment.startDate),
          [Op.lte]: dateToUtcEnd(currentEnrollment.endDate),
        },
      },
    });
  }

  const applied = recommendations.filter((r) => r.status === 'applied').length;
  const read = recommendations.filter((r) => r.status === 'read').length;
  const dismissed = recommendations.filter((r) => r.status === 'dismissed').length;
  const totalRecommendations = recommendations.length;
  const adherencePercent =
    totalRecommendations === 0 ? 0 : Math.round((applied / totalRecommendations) * 100);

  return {
    clientId,
    enrollmentId: currentEnrollment?.id ?? null,
    totalRecommendations,
    applied,
    read,
    dismissed,
    adherencePercent,
  };
}

// ---------- 9.14 ТОП проблем в питании ----------

export interface ProblemAreaAggregate {
  area: string;
  count: number;
  percentOfClients: number;
}

export interface TopProblemsResult {
  period: { from: string; to: string };
  topProblems: ProblemAreaAggregate[];
  totalClients: number;
}

export async function getTopNutritionProblems(
  range: { from?: string; to?: string },
  limit: number,
): Promise<TopProblemsResult> {
  const from = range.from ?? defaultFromDate();
  const to = range.to ?? defaultToDate();

  const where: Record<string, unknown> = {};
  const createdFilter = createdAtFilter({ from, to });
  if (createdFilter) {
    where.createdAt = createdFilter;
  }

  const reports = await Report.findAll({ where });

  const counts = new Map<string, number>();
  const clientsWithProblem = new Map<string, Set<string>>();
  for (const report of reports) {
    const clientId = report.clientId;
    for (const area of report.problemAreas) {
      counts.set(area.area, (counts.get(area.area) ?? 0) + area.count);
      const set = clientsWithProblem.get(area.area) ?? new Set<string>();
      set.add(clientId);
      clientsWithProblem.set(area.area, set);
    }
  }

  const uniqueClientIds = new Set(reports.map((r) => r.clientId));
  const totalClients = uniqueClientIds.size;

  const topProblems = [...counts.entries()]
    .map(([area, count]) => ({
      area,
      count,
      percentOfClients:
        totalClients === 0
          ? 0
          : Math.round(((clientsWithProblem.get(area)?.size ?? 0) / totalClients) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return { period: { from, to }, topProblems, totalClients };
}

function defaultFromDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 30);
  return date.toISOString().slice(0, 10);
}

function defaultToDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------- 9.15 Статистика активности ----------

export interface ActivityClientView {
  clientId: string;
  clientDisplayName: string;
  enrollmentId: string | null;
  totalDays: number;
  filledDays: number;
  fillRatePercent: number;
  lastEntryAt: string | null;
}

export interface ActivityStatisticsResult {
  period: { from: string; to: string };
  clients: ActivityClientView[];
  averageFillRate: number;
}

export async function getActivityStatistics(
  range: { from?: string; to?: string },
  minFillRate?: number,
): Promise<ActivityStatisticsResult> {
  const from = range.from ?? defaultFromDate();
  const to = range.to ?? defaultToDate();
  const fromDate = dateToUtcStart(from);
  const toDate = dateToUtcEnd(to);
  const totalDays = Math.floor((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY) + 1;

  const clients = (await Client.findAll({
    include: [{ model: ClientEnrollment, as: 'enrollments' }],
  })) as unknown as ClientWithEnrollments[];

  const allEntries = await NutritionDiary.findAll({
    where: {
      mealAt: { [Op.gte]: fromDate, [Op.lte]: toDate },
    },
    attributes: ['clientId', 'mealAt'],
  });

  const entriesByClient = new Map<string, Array<{ mealAt: Date }>>();
  for (const entry of allEntries) {
    const list = entriesByClient.get(entry.clientId) ?? [];
    list.push(entry);
    entriesByClient.set(entry.clientId, list);
  }

  const clientItems: ActivityClientView[] = [];
  for (const client of clients) {
    const enrollments = client.enrollments ?? [];
    const currentEnrollment = pickCurrentEnrollment(enrollments);

    const entries = entriesByClient.get(client.id) ?? [];
    const filledDays = new Set(entries.map((e) => e.mealAt.toISOString().slice(0, 10))).size;
    const fillRatePercent = totalDays === 0 ? 0 : Math.round((filledDays / totalDays) * 100);
    const lastEntry =
      entries.length > 0
        ? [...entries].sort((a, b) => b.mealAt.getTime() - a.mealAt.getTime())[0]
        : null;

    const item: ActivityClientView = {
      clientId: client.id,
      clientDisplayName: displayName(client.firstName, client.lastName),
      enrollmentId: currentEnrollment?.id ?? null,
      totalDays,
      filledDays,
      fillRatePercent,
      lastEntryAt: lastEntry ? lastEntry.mealAt.toISOString() : null,
    };

    if (minFillRate === undefined || item.fillRatePercent >= minFillRate) {
      clientItems.push(item);
    }
  }

  clientItems.sort((a, b) => b.fillRatePercent - a.fillRatePercent);

  const averageFillRate =
    clientItems.length === 0
      ? 0
      : Math.round(clientItems.reduce((sum, c) => sum + c.fillRatePercent, 0) / clientItems.length);

  return { period: { from, to }, clients: clientItems, averageFillRate };
}

// ---------- 9.16 Feedback клиента (read-only) ----------

export interface ClientFeedbackView {
  feedbackId: string;
  rating: number;
  comment: string | null;
  source: string;
  isApplied: boolean | null;
  createdAt: string;
}

export interface ClientFeedbackListResult {
  data: ClientFeedbackView[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function listClientFeedback(
  clientId: string,
  pagination: PaginationParams,
): Promise<ClientFeedbackListResult> {
  const client = await Client.findByPk(clientId);
  if (!client) {
    throw new ApiError(404, 'CLIENT_NOT_FOUND', `Client with id '${clientId}' not found`);
  }

  const { rows, count } = await Feedback.findAndCountAll({
    where: { clientId },
    order: [['createdAt', 'DESC']],
    limit: pagination.limit,
    offset: (pagination.page - 1) * pagination.limit,
  });

  const data = rows.map((feedback) => ({
    feedbackId: feedback.id,
    rating: feedback.rating,
    comment: feedback.comment,
    source: feedback.source,
    isApplied: feedback.isApplied,
    createdAt: feedback.createdAt.toISOString(),
  }));

  const totalPages = count === 0 ? 0 : Math.ceil(count / pagination.limit);

  return {
    data,
    pagination: { page: pagination.page, limit: pagination.limit, total: count, totalPages },
  };
}
