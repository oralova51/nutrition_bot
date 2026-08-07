// Детали enrollment и список просроченных ссылок — adminAPI.md §4.3, §4.5.

import {
  Client,
  ClientEnrollment,
  Course,
  EnrollmentLink,
  type ClientEnrollmentStatus,
  type OnboardingStatus,
} from '@nutrition-bot/shared';
import { Op } from 'sequelize';
import { ApiError } from '../http.js';
import { displayName } from '../utils.js';
import { addDaysToIsoDate } from '../validation.js';
import type { PaginationParams } from '../validation.js';

interface EnrollmentWithRelations extends ClientEnrollment {
  client?: Client;
  course?: Course;
}

export interface EnrollmentDetailView {
  id: string;
  clientId: string;
  clientDisplayName: string;
  courseId: string;
  courseName: string;
  status: string;
  startDate: string;
  endDate: string;
  telegramLinked: boolean;
  activeLink: { id: string; url: string; status: string; expiresAt: string } | null;
  linkHistory: Array<{
    id: string;
    status: string;
    createdAt: string;
    expiresAt: string;
    usedAt: string | null;
  }>;
}

/** GET /admin/enrollments/:enrollmentId (adminAPI.md §4.3). */
export async function getEnrollmentDetail(
  enrollmentId: string,
  botUsername: string,
): Promise<EnrollmentDetailView> {
  const enrollment: EnrollmentWithRelations | null = await ClientEnrollment.findByPk(enrollmentId, {
    include: [
      { model: Client, as: 'client' },
      { model: Course, as: 'course' },
    ],
  });

  if (!enrollment) {
    throw new ApiError(
      404,
      'ENROLLMENT_NOT_FOUND',
      `ClientEnrollment with id '${enrollmentId}' not found`,
    );
  }

  const links = await EnrollmentLink.findAll({
    where: { enrollmentId },
    order: [['createdAt', 'DESC']],
  });
  const activeLink = links.find((link) => link.status === 'active') ?? null;
  const history = links.filter((link) => link.id !== activeLink?.id);

  return {
    id: enrollment.id,
    clientId: enrollment.clientId,
    clientDisplayName: enrollment.client
      ? displayName(enrollment.client.firstName, enrollment.client.lastName)
      : '',
    courseId: enrollment.courseId,
    courseName: enrollment.course?.name ?? '',
    status: enrollment.status,
    startDate: enrollment.startDate,
    endDate: enrollment.endDate,
    telegramLinked:
      enrollment.client?.telegramId !== null && enrollment.client?.telegramId !== undefined,
    activeLink: activeLink
      ? {
          id: activeLink.id,
          url: `https://t.me/${botUsername}?start=enr_${activeLink.code}`,
          status: activeLink.status,
          expiresAt: activeLink.expiresAt.toISOString(),
        }
      : null,
    linkHistory: history.map((link) => ({
      id: link.id,
      status: link.status,
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      usedAt: link.usedAt ? link.usedAt.toISOString() : null,
    })),
  };
}

export interface ExpiredLinkItemView {
  enrollmentId: string;
  clientDisplayName: string;
  linkExpiredAt: string;
  daysSinceExpiry: number;
}

export interface ExpiredLinksResult {
  data: ExpiredLinkItemView[];
  pagination: { page: number; limit: number; total: number };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * GET /admin/enrollments/expired-links (adminAPI.md §4.5, roadmap 9.10, CJM alt).
 * Клиент «застрял»: telegramId не привязан, а последняя (самая свежая) ссылка
 * на его активный enrollment уже в статусе `expired` — то есть админ ещё не
 * сгенерировал новую (иначе последней ссылкой была бы новая active).
 */
export async function listExpiredLinkEnrollments(
  pagination: PaginationParams,
): Promise<ExpiredLinksResult> {
  const enrollments = (await ClientEnrollment.findAll({
    where: { status: 'active' },
    include: [{ model: Client, as: 'client', where: { telegramId: null } }],
  })) as EnrollmentWithRelations[];

  if (enrollments.length === 0) {
    return { data: [], pagination: { page: pagination.page, limit: pagination.limit, total: 0 } };
  }

  const links = await EnrollmentLink.findAll({
    where: { enrollmentId: { [Op.in]: enrollments.map((e) => e.id) } },
    order: [['createdAt', 'DESC']],
  });

  const latestLinkByEnrollment = new Map<string, EnrollmentLink>();
  for (const link of links) {
    if (!latestLinkByEnrollment.has(link.enrollmentId)) {
      latestLinkByEnrollment.set(link.enrollmentId, link);
    }
  }

  const now = Date.now();
  const items: ExpiredLinkItemView[] = [];
  for (const enrollment of enrollments) {
    const latestLink = latestLinkByEnrollment.get(enrollment.id);
    if (!latestLink || latestLink.status !== 'expired') {
      continue;
    }
    items.push({
      enrollmentId: enrollment.id,
      clientDisplayName: enrollment.client
        ? displayName(enrollment.client.firstName, enrollment.client.lastName)
        : '',
      linkExpiredAt: latestLink.expiresAt.toISOString(),
      daysSinceExpiry: Math.floor((now - latestLink.expiresAt.getTime()) / MS_PER_DAY),
    });
  }

  items.sort((a, b) => b.daysSinceExpiry - a.daysSinceExpiry);

  const total = items.length;
  const start = (pagination.page - 1) * pagination.limit;
  const data = items.slice(start, start + pagination.limit);

  return { data, pagination: { page: pagination.page, limit: pagination.limit, total } };
}

export interface CreateEnrollmentInput {
  clientId: string;
  courseId: string;
  startDate: string;
}

export interface CreateEnrollmentResult {
  enrollment: ClientEnrollment;
}

export interface EnrollmentView {
  id: string;
  clientId: string;
  courseId: string;
  status: ClientEnrollmentStatus;
  startDate: string;
  endDate: string;
  onboardingStatus: OnboardingStatus;
}

export function serializeEnrollment(enrollment: ClientEnrollment): EnrollmentView {
  return {
    id: enrollment.id,
    clientId: enrollment.clientId,
    courseId: enrollment.courseId,
    status: enrollment.status,
    startDate: enrollment.startDate,
    endDate: enrollment.endDate,
    onboardingStatus: enrollment.onboardingStatus,
  };
}

/**
 * POST /admin/clients/:clientId/enrollments (roadmap 8.4).
 * Создаёт новый ClientEnrollment для существующего клиента (продление курса).
 * Запрещает создание, если у клиента уже есть активный enrollment.
 */
export async function createEnrollmentForClient(
  input: CreateEnrollmentInput,
): Promise<CreateEnrollmentResult> {
  const client = await Client.findByPk(input.clientId);
  if (!client) {
    throw new ApiError(404, 'CLIENT_NOT_FOUND', `Client with id '${input.clientId}' not found`);
  }

  const course = await Course.findByPk(input.courseId);
  if (!course) {
    throw new ApiError(404, 'COURSE_NOT_FOUND', `Course with id '${input.courseId}' not found`);
  }

  const activeEnrollment = await ClientEnrollment.findOne({
    where: {
      clientId: input.clientId,
      status: { [Op.in]: ['active', 'paused'] },
    },
  });
  if (activeEnrollment) {
    throw new ApiError(
      422,
      'ACTIVE_ENROLLMENT_EXISTS',
      `Client already has active or paused enrollment '${activeEnrollment.id}'. Complete or cancel it before creating a new one.`,
    );
  }

  const endDate = addDaysToIsoDate(input.startDate, course.durationDays);

  const enrollment = await ClientEnrollment.create({
    clientId: input.clientId,
    courseId: input.courseId,
    startDate: input.startDate,
    endDate,
    onboardingStatus: 'completed',
  });

  return { enrollment };
}
