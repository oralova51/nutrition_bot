// Проверка admin-авторизации — adminAPI.md §1: `Authorization: Bearer <ADMIN_API_TOKEN>`.

import type { IncomingMessage } from 'node:http';
import { ApiError } from './http.js';

const BEARER_PREFIX = 'Bearer ';

/** Бросает ApiError(401), если заголовок Authorization отсутствует или токен неверный. */
export function requireAdminAuth(req: IncomingMessage, expectedToken: string): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Требуется заголовок Authorization: Bearer <token>');
  }

  const token = header.slice(BEARER_PREFIX.length).trim();
  if (token !== expectedToken) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Неверный admin-токен');
  }
}
