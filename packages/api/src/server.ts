// HTTP-сервер API: маршрутизация и обработка запросов.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { Logger } from 'pino';
import { requireAdminAuth } from './admin-auth.js';
import { resolveAdminApiToken, resolveBotUsername } from './config.js';
import { getHealthStatus } from './health.js';
import { ApiError, sendApiError, sendJson } from './http.js';
import { findRoute, type RouteDefinition } from './router.js';
import { createAiClarityRoutes } from './routes/ai-clarity.js';
import { createClientRoutes } from './routes/clients.js';
import {
  createAdminDashboardRoutes,
  createSpecialistDashboardRoutes,
} from './routes/dashboards.js';
import { createCourseRoutes } from './routes/courses.js';
import { createEnrollmentLinkRoutes } from './routes/enrollment-links.js';
import { createEnrollmentRoutes } from './routes/enrollments.js';

const API_PREFIX = '/api/v1';
const HEALTH_PATH = `${API_PREFIX}/health`;

function stripApiPrefix(pathname: string): string | null {
  if (pathname === API_PREFIX) {
    return '/';
  }
  if (!pathname.startsWith(`${API_PREFIX}/`)) {
    return null;
  }
  return pathname.slice(API_PREFIX.length);
}

function buildRoutes(): RouteDefinition[] {
  const botUsername = resolveBotUsername();
  return [
    ...createEnrollmentLinkRoutes(botUsername),
    // expired-links (литеральный путь) должен идти раньше :enrollmentId — см. router.ts.
    ...createEnrollmentRoutes(botUsername),
    ...createCourseRoutes(),
    ...createClientRoutes(botUsername),
    ...createAdminDashboardRoutes(botUsername),
    ...createSpecialistDashboardRoutes(),
    ...createAiClarityRoutes(),
  ];
}

async function handleHealth(res: ServerResponse): Promise<void> {
  const payload = await getHealthStatus();
  const statusCode = payload.status === 'ok' ? 200 : 503;
  sendJson(res, statusCode, payload);
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  routes: RouteDefinition[],
  adminApiToken: string,
  logger: Logger,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';
  const path = stripApiPrefix(url.pathname);

  if (path === null) {
    sendJson(res, 404, {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${method} ${url.pathname} not found`,
        details: {},
      },
    });
    return;
  }

  if (method === 'GET' && path === '/health') {
    await handleHealth(res);
    return;
  }

  const match = findRoute(routes, method, path);
  if (!match) {
    sendJson(res, 404, {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${method} ${url.pathname} not found`,
        details: {},
      },
    });
    logger.warn({ method, path: url.pathname }, 'Route not found');
    return;
  }

  if (match.route.requiresAdminAuth) {
    requireAdminAuth(req, adminApiToken);
  }

  await match.route.handler({ req, res, params: match.params, query: url.searchParams, logger });
}

export function createApiServer(logger: Logger): Server {
  const routes = buildRoutes();
  const adminApiToken = resolveAdminApiToken();

  const server = createServer((req, res) => {
    void handleRequest(req, res, routes, adminApiToken, logger).catch((err: unknown) => {
      if (err instanceof ApiError) {
        sendApiError(res, err);
        return;
      }

      logger.error({ err, method: req.method, url: req.url }, 'Unhandled request error');
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
            details: {},
          },
        });
      }
    });
  });

  return server;
}

export { HEALTH_PATH };
