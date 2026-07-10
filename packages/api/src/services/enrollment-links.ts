// Генерация и regenerate enrollment-ссылок — roadmap 3.2, 3.5; adminAPI.md §2, §4.4.
// Единая партиционная уникальность «не более 1 активной ссылки на enrollment»
// обеспечена индексом `enrollment_links_one_active_per_enrollment` (миграция) —
// перед вставкой новой ссылки текущая active-ссылка обязательно переводится
// в revoked/expired, иначе insert упадёт на constraint.

import { randomBytes } from 'node:crypto';
import { ClientEnrollment, EnrollmentLink, EnrollmentLinkAttempt } from '@nutrition-bot/shared';
import { Op } from 'sequelize';
import { ApiError } from '../http.js';
import { toNullableNumber } from '../validation.js';

/** adminAPI.md §2: код — 16 символов base64url (без префикса `enr_`). */
const CODE_BYTES = 12;
const LINK_EXPIRY_DAYS = 7;
/** adminAPI.md §2: префикс кода в deep link payload. */
const CODE_PREFIX = 'enr_';

export interface EnrollmentLinkView {
  id: string;
  code: string;
  url: string;
  enrollmentId: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

function generateLinkCode(): string {
  return randomBytes(CODE_BYTES).toString('base64url');
}

function buildDeepLinkUrl(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${CODE_PREFIX}${code}`;
}

export function serializeEnrollmentLink(
  link: EnrollmentLink,
  botUsername: string,
): EnrollmentLinkView {
  return {
    id: link.id,
    code: `${CODE_PREFIX}${link.code}`,
    url: buildDeepLinkUrl(botUsername, link.code),
    enrollmentId: link.enrollmentId,
    status: link.status,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(),
    usedAt: link.usedAt ? link.usedAt.toISOString() : null,
  };
}

async function loadActiveEnrollment(enrollmentId: string): Promise<ClientEnrollment> {
  const enrollment = await ClientEnrollment.findByPk(enrollmentId);
  if (!enrollment) {
    throw new ApiError(
      404,
      'ENROLLMENT_NOT_FOUND',
      `ClientEnrollment with id '${enrollmentId}' not found`,
    );
  }

  if (enrollment.status !== 'active') {
    throw new ApiError(
      422,
      'ENROLLMENT_NOT_ACTIVE',
      `ClientEnrollment '${enrollmentId}' has status '${enrollment.status}', expected 'active'`,
    );
  }

  return enrollment;
}

async function insertNewLink(enrollmentId: string): Promise<EnrollmentLink> {
  const now = Date.now();
  return EnrollmentLink.create({
    enrollmentId,
    code: generateLinkCode(),
    expiresAt: new Date(now + LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
  });
}

export interface CreateLinkOptions {
  force: boolean;
}

/**
 * POST /admin/enrollments/:id/link (roadmap 3.2).
 * Создаёт новую ссылку. Если уже есть active-ссылка — 409, пока не передан force:true
 * (тогда текущая active-ссылка отзывается перед созданием новой).
 */
export async function createEnrollmentLink(
  enrollmentId: string,
  options: CreateLinkOptions,
): Promise<EnrollmentLink> {
  await loadActiveEnrollment(enrollmentId);

  const activeLink = await EnrollmentLink.findOne({
    where: { enrollmentId, status: 'active' },
  });

  if (activeLink) {
    if (!options.force) {
      throw new ApiError(
        409,
        'ACTIVE_LINK_EXISTS',
        'У enrollment уже есть активная ссылка. Передайте force:true, чтобы отозвать её и создать новую.',
      );
    }
    await activeLink.update({ status: 'revoked', revokedAt: new Date() });
  }

  return insertNewLink(enrollmentId);
}

/**
 * POST /admin/enrollments/:id/link/regenerate (roadmap 3.5).
 * Для истёкших/отозванных ссылок. Если текущая ссылка ещё valid и не used — 422
 * LINK_STILL_ACTIVE (используйте force:true на обычном endpoint).
 */
export async function regenerateEnrollmentLink(enrollmentId: string): Promise<EnrollmentLink> {
  await loadActiveEnrollment(enrollmentId);

  const activeLink = await EnrollmentLink.findOne({
    where: { enrollmentId, status: 'active' },
  });

  if (activeLink) {
    if (activeLink.expiresAt.getTime() > Date.now()) {
      throw new ApiError(
        422,
        'LINK_STILL_ACTIVE',
        'Текущая ссылка ещё действительна и не использована. Используйте force:true на POST /link.',
      );
    }
    // Срок истёк, но статус не был лениво обновлён (обновляется при попытке
    // активации ссылки клиентом) — переводим в expired перед созданием новой.
    await activeLink.update({ status: 'expired' });
  }

  return insertNewLink(enrollmentId);
}

async function ensureEnrollmentExists(enrollmentId: string): Promise<void> {
  const enrollment = await ClientEnrollment.findByPk(enrollmentId);
  if (!enrollment) {
    throw new ApiError(
      404,
      'ENROLLMENT_NOT_FOUND',
      `ClientEnrollment with id '${enrollmentId}' not found`,
    );
  }
}

export interface EnrollmentLinkInfo {
  active: { id: string; url: string; status: string; expiresAt: string } | null;
  history: Array<{
    id: string;
    status: string;
    createdAt: string;
    expiresAt: string;
    usedAt: string | null;
  }>;
  attempts: Array<{ attemptedAt: string; result: string; telegramId: number | null }>;
}

/** GET /admin/enrollments/:enrollmentId/link (adminAPI.md §4.4). */
export async function getEnrollmentLinkInfo(
  enrollmentId: string,
  botUsername: string,
): Promise<EnrollmentLinkInfo> {
  await ensureEnrollmentExists(enrollmentId);

  const links = await EnrollmentLink.findAll({
    where: { enrollmentId },
    order: [['createdAt', 'DESC']],
  });
  const active = links.find((link) => link.status === 'active') ?? null;
  const history = links.filter((link) => link.id !== active?.id);

  const attempts =
    links.length === 0
      ? []
      : await EnrollmentLinkAttempt.findAll({
          where: { linkId: { [Op.in]: links.map((link) => link.id) } },
          order: [['attemptedAt', 'DESC']],
        });

  return {
    active: active
      ? {
          id: active.id,
          url: buildDeepLinkUrl(botUsername, active.code),
          status: active.status,
          expiresAt: active.expiresAt.toISOString(),
        }
      : null,
    history: history.map((link) => ({
      id: link.id,
      status: link.status,
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      usedAt: link.usedAt ? link.usedAt.toISOString() : null,
    })),
    attempts: attempts.map((attempt) => ({
      attemptedAt: attempt.attemptedAt.toISOString(),
      result: attempt.result,
      telegramId: toNullableNumber(attempt.telegramId),
    })),
  };
}

export interface RevokeLinkResult {
  status: 'revoked';
  revokedAt: string;
}

/**
 * DELETE /admin/enrollments/:enrollmentId/link/:linkId (adminAPI.md §4.4).
 * Отзыв допустим только для активной (не использованной/не истёкшей) ссылки.
 */
export async function revokeEnrollmentLink(
  enrollmentId: string,
  linkId: string,
): Promise<RevokeLinkResult> {
  const link = await EnrollmentLink.findOne({ where: { id: linkId, enrollmentId } });
  if (!link) {
    throw new ApiError(
      404,
      'LINK_NOT_FOUND',
      `EnrollmentLink with id '${linkId}' not found for enrollment '${enrollmentId}'`,
    );
  }

  if (link.status !== 'active') {
    throw new ApiError(
      422,
      'LINK_NOT_ACTIVE',
      `EnrollmentLink '${linkId}' has status '${link.status}', only an active link can be revoked`,
    );
  }

  const revokedAt = new Date();
  await link.update({ status: 'revoked', revokedAt });

  return { status: 'revoked', revokedAt: revokedAt.toISOString() };
}
