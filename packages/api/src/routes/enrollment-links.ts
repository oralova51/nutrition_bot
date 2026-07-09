// Роуты генерации/regenerate enrollment-ссылок — roadmap 3.2, 3.5; adminAPI.md §4.4.

import { ApiError, readJsonBody, sendJson } from '../http.js';
import type { RouteContext, RouteDefinition } from '../router.js';
import {
  createEnrollmentLink,
  regenerateEnrollmentLink,
  serializeEnrollmentLink,
} from '../services/enrollment-links.js';

function parseForceFlag(body: unknown): boolean {
  if (body === null || typeof body !== 'object') {
    return false;
  }

  const { force } = body as Record<string, unknown>;
  if (force === undefined) {
    return false;
  }
  if (typeof force !== 'boolean') {
    throw new ApiError(400, 'INVALID_BODY', 'Поле "force" должно быть boolean');
  }
  return force;
}

function requireEnrollmentId(params: Record<string, string>): string {
  const enrollmentId = params.enrollmentId;
  if (!enrollmentId) {
    throw new ApiError(400, 'INVALID_PARAMS', 'enrollmentId обязателен в пути запроса');
  }
  return enrollmentId;
}

/** @param botUsername username бота (без @) для построения deep link в ответе. */
export function createEnrollmentLinkRoutes(botUsername: string): RouteDefinition[] {
  return [
    {
      method: 'POST',
      pattern: '/admin/enrollments/:enrollmentId/link',
      requiresAdminAuth: true,
      handler: async ({ req, res, params }: RouteContext): Promise<void> => {
        const enrollmentId = requireEnrollmentId(params);
        const force = parseForceFlag(await readJsonBody(req));

        const link = await createEnrollmentLink(enrollmentId, { force });
        sendJson(res, 201, { link: serializeEnrollmentLink(link, botUsername) });
      },
    },
    {
      method: 'POST',
      pattern: '/admin/enrollments/:enrollmentId/link/regenerate',
      requiresAdminAuth: true,
      handler: async ({ req, res, params }: RouteContext): Promise<void> => {
        const enrollmentId = requireEnrollmentId(params);
        // Тело запроса у regenerate не используется, но поток нужно вычитать до конца.
        await readJsonBody(req);

        const link = await regenerateEnrollmentLink(enrollmentId);
        sendJson(res, 201, { link: serializeEnrollmentLink(link, botUsername) });
      },
    },
  ];
}
