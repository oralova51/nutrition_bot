// Операции админ-панели в боте: курс, приглашение (клиент + enrollment + deep link).
// Повторяет бизнес-логику admin API (§4.2–4.4), чтобы не ломать существующий Postman-flow.
// Бот ходит в БД напрямую (как enrollment-link-activation), без HTTP к api-сервису.

import { randomBytes } from 'node:crypto';
import {
  Client,
  ClientEnrollment,
  Course,
  EnrollmentLink,
  NotificationSettings,
  getSequelize,
} from '@nutrition-bot/shared';

const CODE_BYTES = 12;
const CODE_PREFIX = 'enr_';
const LINK_EXPIRY_DAYS = 7;
const MAX_COURSES_IN_KEYBOARD = 20;

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysToIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function generateLinkCode(): string {
  return randomBytes(CODE_BYTES).toString('base64url');
}

function buildDeepLinkUrl(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${CODE_PREFIX}${code}`;
}

export function resolveBotUsername(): string {
  const raw = process.env.BOT_USERNAME?.trim();
  if (!raw) {
    throw new Error('BOT_USERNAME не задан — нужен для сборки deep link (см. .env.example).');
  }
  return raw.replace(/^@/, '');
}

/** «Анна Иванова» → first/last; одно слово → lastName = «-». */
export function parseClientName(raw: string): { firstName: string; lastName: string } | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    return null;
  }
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { firstName: trimmed, lastName: '-' };
  }
  const firstName = trimmed.slice(0, spaceIdx).trim();
  const lastName = trimmed.slice(spaceIdx + 1).trim();
  if (firstName.length === 0 || lastName.length === 0) {
    return null;
  }
  return { firstName, lastName };
}

export function parseDurationDays(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const days = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return null;
  }
  return days;
}

export async function listCoursesForAdmin(): Promise<Course[]> {
  return Course.findAll({
    order: [['startDate', 'DESC']],
    limit: MAX_COURSES_IN_KEYBOARD,
  });
}

export async function createCourseByDays(durationDays: number): Promise<Course> {
  const startDate = todayIsoDate();
  const endDate = addDaysToIsoDate(startDate, durationDays);
  const name = `Курс ${durationDays} дней`;

  return Course.create({
    name,
    durationDays,
    startDate,
    endDate,
  });
}

export interface InviteClientResult {
  client: Client;
  enrollment: ClientEnrollment;
  course: Course;
  linkUrl: string;
  linkExpiresAt: Date;
}

/**
 * Happy path админа: Client + NotificationSettings + Enrollment + active EnrollmentLink.
 * Соответствует POST /admin/clients + POST /admin/enrollments/:id/link.
 */
export async function inviteClient(input: {
  firstName: string;
  lastName: string;
  courseId: string;
}): Promise<InviteClientResult> {
  const course = await Course.findByPk(input.courseId);
  if (!course) {
    throw new Error('COURSE_NOT_FOUND');
  }

  const botUsername = resolveBotUsername();
  const enrollmentStartDate = todayIsoDate();
  const endDate = addDaysToIsoDate(enrollmentStartDate, course.durationDays);

  return getSequelize().transaction(async (transaction) => {
    const client = await Client.create(
      {
        firstName: input.firstName,
        lastName: input.lastName,
        email: null,
        phone: null,
      },
      { transaction },
    );

    await NotificationSettings.create({ clientId: client.id }, { transaction });

    const enrollment = await ClientEnrollment.create(
      {
        clientId: client.id,
        courseId: course.id,
        startDate: enrollmentStartDate,
        endDate,
      },
      { transaction },
    );

    const link = await EnrollmentLink.create(
      {
        enrollmentId: enrollment.id,
        code: generateLinkCode(),
        expiresAt: new Date(Date.now() + LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
      { transaction },
    );

    return {
      client,
      enrollment,
      course,
      linkUrl: buildDeepLinkUrl(botUsername, link.code),
      linkExpiresAt: link.expiresAt,
    };
  });
}
