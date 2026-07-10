// Клиенты и enrollments — adminAPI.md §4.3.

import {
  Client,
  ClientEnrollment,
  Course,
  EnrollmentLink,
  NotificationSettings,
  getSequelize,
  type ClientEnrollmentStatus,
  type DisabledReason,
  type OnboardingStatus,
} from '@nutrition-bot/shared';
import { Op } from 'sequelize';
import { ApiError } from '../http.js';
import { addDaysToIsoDate, toNullableNumber, type PaginationParams } from '../validation.js';

const CODE_PREFIX = 'enr_';

function buildDeepLinkUrl(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${CODE_PREFIX}${code}`;
}

/** adminAPI.md §4.3: в списке — инициалы, полное ФИ только в деталях клиента. */
function displayName(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0);
  return initial ? `${firstName} ${initial}.` : firstName;
}

export interface CreateClientInput {
  firstName: string;
  lastName: string;
  email: string | null;
  courseId: string;
  enrollmentStartDate: string;
}

export interface CreateClientResult {
  client: Client;
  enrollment: ClientEnrollment;
}

/**
 * POST /admin/clients (adminAPI.md §4.3).
 * Создаёт Client + NotificationSettings по умолчанию (SA_SUMMARY §4, правило 3) +
 * ClientEnrollment (`endDate = enrollmentStartDate + course.durationDays`, как в примере доки).
 */
export async function createClientWithEnrollment(
  input: CreateClientInput,
): Promise<CreateClientResult> {
  const course = await Course.findByPk(input.courseId);
  if (!course) {
    throw new ApiError(404, 'COURSE_NOT_FOUND', `Course with id '${input.courseId}' not found`);
  }

  const endDate = addDaysToIsoDate(input.enrollmentStartDate, course.durationDays);

  return getSequelize().transaction(async (transaction) => {
    const client = await Client.create(
      {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
      },
      { transaction },
    );

    await NotificationSettings.create({ clientId: client.id }, { transaction });

    const enrollment = await ClientEnrollment.create(
      {
        clientId: client.id,
        courseId: course.id,
        startDate: input.enrollmentStartDate,
        endDate,
      },
      { transaction },
    );

    return { client, enrollment };
  });
}

export interface ClientCreatedView {
  client: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    telegramId: number | null;
    registeredAt: string;
  };
  enrollment: {
    id: string;
    courseId: string;
    status: ClientEnrollmentStatus;
    startDate: string;
    endDate: string;
    onboardingStatus: OnboardingStatus;
  };
}

export function serializeCreatedClient(result: CreateClientResult): ClientCreatedView {
  return {
    client: {
      id: result.client.id,
      firstName: result.client.firstName,
      lastName: result.client.lastName,
      email: result.client.email,
      telegramId: toNullableNumber(result.client.telegramId),
      registeredAt: result.client.registeredAt.toISOString(),
    },
    enrollment: {
      id: result.enrollment.id,
      courseId: result.enrollment.courseId,
      status: result.enrollment.status,
      startDate: result.enrollment.startDate,
      endDate: result.enrollment.endDate,
      onboardingStatus: result.enrollment.onboardingStatus,
    },
  };
}

/** Клиент со всеми своими enrollment'ами и связанными сущностями — общая заготовка для list/detail. */
interface ClientWithRelations extends Client {
  enrollments?: Array<ClientEnrollment & { course?: Course }>;
  notificationSettings?: NotificationSettings;
}

/** MVP: продление курса (roadmap этап 8) ещё не реализовано — берём активный enrollment,
 * либо (если активного нет) enrollment с наибольшей startDate как «текущий». */
function pickCurrentEnrollment(
  enrollments: Array<ClientEnrollment & { course?: Course }>,
): (ClientEnrollment & { course?: Course }) | null {
  if (enrollments.length === 0) {
    return null;
  }
  const active = enrollments.find((e) => e.status === 'active');
  if (active) {
    return active;
  }
  return [...enrollments].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] ?? null;
}

/** adminAPI.md §4.3: active = enrollment active + notifications enabled + есть telegramId. */
function computeDerivedStatus(params: {
  hasTelegram: boolean;
  notificationsEnabled: boolean;
  enrollmentStatus: ClientEnrollmentStatus | null;
}): 'active' | 'inactive' {
  if (params.hasTelegram && params.notificationsEnabled && params.enrollmentStatus === 'active') {
    return 'active';
  }
  return 'inactive';
}

export interface ClientListFilters {
  status?: 'active' | 'inactive' | 'all';
  enrollmentStatus?: ClientEnrollmentStatus;
  onboardingStatus?: OnboardingStatus;
  hasTelegram?: boolean;
  linkStatus?: 'no_link' | 'active' | 'expired' | 'used';
  sort?: 'registeredAt' | 'lastInteractionAt' | 'enrollmentEndDate';
  order?: 'asc' | 'desc';
}

export interface ClientListItemView {
  id: string;
  displayName: string;
  telegramId: number | null;
  telegramUsername: string | null;
  enrollment: {
    id: string;
    courseName: string;
    status: ClientEnrollmentStatus;
    startDate: string;
    endDate: string;
  } | null;
  onboarding: {
    status: OnboardingStatus | null;
    currentQuestion: number | null;
    totalQuestions: number | null;
    lastAnswerAt: string | null;
  };
  notifications: {
    enabled: boolean;
    disabledReason: DisabledReason | null;
  };
  link: {
    status: string;
    expiresAt: string;
    url: string;
  } | null;
  lastInteractionAt: string | null;
  registeredAt: string;
}

export interface ListClientsResult {
  data: ClientListItemView[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * GET /admin/clients (adminAPI.md §4.3).
 * MVP: базовые фильтры (hasTelegram) уходят в SQL, производные поля (status/link/
 * onboarding-агрегаты) считаются в памяти — приемлемо для объёма одной студии (nonFR §4).
 * `onboarding.currentQuestion/totalQuestions/lastAnswerAt` — `null`, пока не реализована
 * модель Questionnaire (roadmap 3.7+, этап 3B); поле `status` в Questionnaire уже
 * отражено через `ClientEnrollment.onboardingStatus`.
 */
export async function listClients(
  filters: ClientListFilters,
  pagination: PaginationParams,
  botUsername: string,
): Promise<ListClientsResult> {
  const where: Record<string, unknown> = {};
  if (filters.hasTelegram !== undefined) {
    where.telegramId = filters.hasTelegram ? { [Op.ne]: null } : null;
  }

  const clients = (await Client.findAll({
    where,
    include: [
      { model: ClientEnrollment, as: 'enrollments', include: [{ model: Course, as: 'course' }] },
      { model: NotificationSettings, as: 'notificationSettings' },
    ],
  })) as ClientWithRelations[];

  const enrollmentIds = clients.flatMap((c) => (c.enrollments ?? []).map((e) => e.id));
  const latestLinksByEnrollment = await loadLatestLinksByEnrollment(enrollmentIds);

  const computed = clients
    .map((client) => buildClientListItem(client, latestLinksByEnrollment, botUsername))
    .filter((item) => matchesFilters(item, filters));

  sortComputed(computed, filters.sort ?? 'registeredAt', filters.order ?? 'desc');

  const total = computed.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pagination.limit);
  const start = (pagination.page - 1) * pagination.limit;
  // Служебные `derivedStatus`/`linkStatus` использовались только для фильтрации/сортировки —
  // в ответе клиенту (adminAPI.md §4.3) их не должно быть.
  const data = computed.slice(start, start + pagination.limit).map((item) => item.view);

  return {
    data,
    pagination: { page: pagination.page, limit: pagination.limit, total, totalPages },
  };
}

async function loadLatestLinksByEnrollment(
  enrollmentIds: string[],
): Promise<Map<string, EnrollmentLink>> {
  if (enrollmentIds.length === 0) {
    return new Map();
  }

  const links = await EnrollmentLink.findAll({
    where: { enrollmentId: { [Op.in]: enrollmentIds } },
    order: [['createdAt', 'DESC']],
  });

  const latest = new Map<string, EnrollmentLink>();
  for (const link of links) {
    if (!latest.has(link.enrollmentId)) {
      latest.set(link.enrollmentId, link);
    }
  }
  return latest;
}

interface ComputedClientListItem {
  view: ClientListItemView;
  derivedStatus: 'active' | 'inactive';
  linkStatus: string;
}

function buildClientListItem(
  client: ClientWithRelations,
  latestLinksByEnrollment: Map<string, EnrollmentLink>,
  botUsername: string,
): ComputedClientListItem {
  const enrollments = client.enrollments ?? [];
  const currentEnrollment = pickCurrentEnrollment(enrollments);
  const latestLink = currentEnrollment
    ? latestLinksByEnrollment.get(currentEnrollment.id)
    : undefined;
  const notificationsEnabled = client.notificationSettings?.enabled ?? true;
  const hasTelegram = client.telegramId !== null;

  const view: ClientListItemView = {
    id: client.id,
    displayName: displayName(client.firstName, client.lastName),
    telegramId: toNullableNumber(client.telegramId),
    telegramUsername: client.telegramUsername,
    enrollment: currentEnrollment
      ? {
          id: currentEnrollment.id,
          courseName: currentEnrollment.course?.name ?? '',
          status: currentEnrollment.status,
          startDate: currentEnrollment.startDate,
          endDate: currentEnrollment.endDate,
        }
      : null,
    onboarding: {
      status: currentEnrollment?.onboardingStatus ?? null,
      currentQuestion: null,
      totalQuestions: null,
      lastAnswerAt: null,
    },
    notifications: {
      enabled: notificationsEnabled,
      disabledReason: client.notificationSettings?.disabledReason ?? null,
    },
    link: latestLink
      ? {
          status: latestLink.status,
          expiresAt: latestLink.expiresAt.toISOString(),
          url: buildDeepLinkUrl(botUsername, latestLink.code),
        }
      : null,
    lastInteractionAt: client.lastInteractionAt ? client.lastInteractionAt.toISOString() : null,
    registeredAt: client.registeredAt.toISOString(),
  };

  return {
    view,
    derivedStatus: computeDerivedStatus({
      hasTelegram,
      notificationsEnabled,
      enrollmentStatus: currentEnrollment?.status ?? null,
    }),
    linkStatus: latestLink?.status ?? 'no_link',
  };
}

function matchesFilters(item: ComputedClientListItem, filters: ClientListFilters): boolean {
  if (filters.status && filters.status !== 'all' && item.derivedStatus !== filters.status) {
    return false;
  }
  if (filters.enrollmentStatus && item.view.enrollment?.status !== filters.enrollmentStatus) {
    return false;
  }
  if (filters.onboardingStatus && item.view.onboarding.status !== filters.onboardingStatus) {
    return false;
  }
  if (filters.linkStatus && item.linkStatus !== filters.linkStatus) {
    return false;
  }
  return true;
}

function sortComputed(
  items: ComputedClientListItem[],
  sort: 'registeredAt' | 'lastInteractionAt' | 'enrollmentEndDate',
  order: 'asc' | 'desc',
): void {
  const factor = order === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    const left = sortKey(a.view, sort);
    const right = sortKey(b.view, sort);
    if (left === right) {
      return 0;
    }
    if (left === null) {
      return 1;
    }
    if (right === null) {
      return -1;
    }
    return left < right ? -factor : factor;
  });
}

function sortKey(
  view: ClientListItemView,
  sort: 'registeredAt' | 'lastInteractionAt' | 'enrollmentEndDate',
): string | null {
  if (sort === 'registeredAt') {
    return view.registeredAt;
  }
  if (sort === 'lastInteractionAt') {
    return view.lastInteractionAt;
  }
  return view.enrollment?.endDate ?? null;
}

export interface ClientDetailView {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  telegramId: number | null;
  telegramUsername: string | null;
  registeredAt: string;
  lastInteractionAt: string | null;
  enrollments: Array<{
    id: string;
    courseId: string;
    courseName: string;
    status: ClientEnrollmentStatus;
    startDate: string;
    endDate: string;
  }>;
  currentEnrollmentId: string | null;
  onboarding: {
    status: OnboardingStatus | null;
    completedAt: null;
  };
  notifications: {
    enabled: boolean;
    reminderTime: string;
    frequency: string;
    timezone: string;
  };
}

/** GET /admin/clients/:clientId (adminAPI.md §4.3). */
export async function getClientDetail(clientId: string): Promise<ClientDetailView> {
  const client: ClientWithRelations | null = await Client.findByPk(clientId, {
    include: [
      { model: ClientEnrollment, as: 'enrollments', include: [{ model: Course, as: 'course' }] },
      { model: NotificationSettings, as: 'notificationSettings' },
    ],
  });

  if (!client) {
    throw new ApiError(404, 'CLIENT_NOT_FOUND', `Client with id '${clientId}' not found`);
  }

  const enrollments = client.enrollments ?? [];
  const currentEnrollment = pickCurrentEnrollment(enrollments);
  const notificationSettings = client.notificationSettings;

  return {
    id: client.id,
    firstName: client.firstName,
    lastName: client.lastName,
    email: client.email,
    telegramId: toNullableNumber(client.telegramId),
    telegramUsername: client.telegramUsername,
    registeredAt: client.registeredAt.toISOString(),
    lastInteractionAt: client.lastInteractionAt ? client.lastInteractionAt.toISOString() : null,
    enrollments: enrollments.map((enrollment) => ({
      id: enrollment.id,
      courseId: enrollment.courseId,
      courseName: enrollment.course?.name ?? '',
      status: enrollment.status,
      startDate: enrollment.startDate,
      endDate: enrollment.endDate,
    })),
    currentEnrollmentId: currentEnrollment?.id ?? null,
    onboarding: {
      status: currentEnrollment?.onboardingStatus ?? null,
      // Questionnaire (roadmap 3.7+) пока не реализован — источника completedAt нет.
      completedAt: null,
    },
    notifications: {
      enabled: notificationSettings?.enabled ?? true,
      reminderTime: notificationSettings?.reminderTime ?? '09:00',
      frequency: notificationSettings?.frequency ?? 'daily',
      timezone: notificationSettings?.timezone ?? 'Europe/Moscow',
    },
  };
}
