// Минимальный роутер поверх node:http с поддержкой параметров пути (`:param`).
// Проект осознанно без Express (см. server.ts) — этот модуль даёт точечную
// маршрутизацию для растущего набора admin-эндпоинтов без лишней зависимости.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  logger: Logger;
}

export interface RouteDefinition {
  method: string;
  /** Паттерн вида `/admin/enrollments/:enrollmentId/link`. */
  pattern: string;
  requiresAdminAuth: boolean;
  handler: (ctx: RouteContext) => Promise<void>;
}

function splitSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/** Сопоставляет паттерн с реальным путём, извлекая именованные параметры. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternSegments = splitSegments(pattern);
  const pathSegments = splitSegments(pathname);

  if (patternSegments.length !== pathSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternSegments.length; i += 1) {
    const patternSegment = patternSegments[i];
    const pathSegment = pathSegments[i];
    if (patternSegment === undefined || pathSegment === undefined) {
      return null;
    }

    if (patternSegment.startsWith(':')) {
      params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
    } else if (patternSegment !== pathSegment) {
      return null;
    }
  }

  return params;
}

export function findRoute(
  routes: RouteDefinition[],
  method: string,
  pathname: string,
): { route: RouteDefinition; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
    const params = matchPath(route.pattern, pathname);
    if (params) {
      return { route, params };
    }
  }
  return null;
}
