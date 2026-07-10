// Роуты enrollment (детали, просроченные ссылки) — adminAPI.md §4.3, §4.5.

import { ApiError, sendJson } from '../http.js';
import type { RouteContext, RouteDefinition } from '../router.js';
import { getEnrollmentDetail, listExpiredLinkEnrollments } from '../services/enrollments.js';
import { parsePagination } from '../validation.js';

function requireEnrollmentId(params: Record<string, string>): string {
  const enrollmentId = params.enrollmentId;
  if (!enrollmentId) {
    throw new ApiError(400, 'INVALID_PARAMS', 'enrollmentId обязателен в пути запроса');
  }
  return enrollmentId;
}

/**
 * @param botUsername username бота (без @) для построения deep link в `activeLink.url`.
 * Порядок важен: `expired-links` — литеральный путь, должен проверяться раньше
 * параметризованного `:enrollmentId` (см. router.ts — совпадение по числу сегментов).
 */
export function createEnrollmentRoutes(botUsername: string): RouteDefinition[] {
  return [
    {
      method: 'GET',
      pattern: '/admin/enrollments/expired-links',
      requiresAdminAuth: true,
      handler: async ({ res, query }: RouteContext): Promise<void> => {
        const pagination = parsePagination(query);
        const result = await listExpiredLinkEnrollments(pagination);
        sendJson(res, 200, result);
      },
    },
    {
      method: 'GET',
      pattern: '/admin/enrollments/:enrollmentId',
      requiresAdminAuth: true,
      handler: async ({ res, params }: RouteContext): Promise<void> => {
        const enrollmentId = requireEnrollmentId(params);
        const detail = await getEnrollmentDetail(enrollmentId, botUsername);
        sendJson(res, 200, detail);
      },
    },
  ];
}
