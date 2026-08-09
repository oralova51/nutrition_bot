// HTTP API планировщика: ручной запуск job'ов (force) для локального теста через Postman.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { Logger } from 'pino';
import { runDailyReminderJob } from './jobs/daily-reminder.js';
import { runEveningReminderJob } from './jobs/evening-reminder-job.js';
import { runEveningSummaryJob } from './jobs/evening-summary-job.js';
import type { SchedulerJobOptions, SchedulerJobResult } from './jobs/types.js';

const BEARER_PREFIX = 'Bearer ';
const MAX_BODY_BYTES = 16 * 1024;

type JobRunner = (logger: Logger, options: SchedulerJobOptions) => Promise<SchedulerJobResult>;

const JOB_ROUTES: Record<string, JobRunner> = {
  '/internal/jobs/daily-reminder': runDailyReminderJob,
  '/internal/jobs/evening-reminder': runEveningReminderJob,
  '/internal/jobs/evening-summary': runEveningSummaryJob,
};

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function requireAdminAuth(req: IncomingMessage, expectedToken: string): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new AuthError('Требуется заголовок Authorization: Bearer <token>');
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (token !== expectedToken) {
    throw new AuthError('Неверный admin-токен');
  }
}

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('INVALID_BODY'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error('INVALID_BODY'));
      }
    });

    req.on('error', reject);
  });
}

function parseJobOptions(
  body: Record<string, unknown>,
  query: URLSearchParams,
): SchedulerJobOptions {
  const forceFromQuery = query.get('force');
  const forceFromBody = body.force;
  const force =
    forceFromBody === true ||
    forceFromQuery === 'true' ||
    forceFromQuery === '1';

  const clientIdRaw = body.clientId ?? query.get('clientId');
  const clientId =
    typeof clientIdRaw === 'string' && clientIdRaw.trim().length > 0
      ? clientIdRaw.trim()
      : undefined;

  return { force, clientId };
}

export function createSchedulerHttpServer(logger: Logger, adminApiToken: string): Server {
  return createServer((req, res) => {
    void handleRequest(req, res, logger, adminApiToken).catch((err: unknown) => {
      if (err instanceof AuthError) {
        logger.warn(
          {
            method: req.method,
            url: req.url,
            hasAuthorizationHeader: Boolean(req.headers.authorization),
            message: err.message,
          },
          'Scheduler HTTP 401 Unauthorized',
        );
        sendJson(res, 401, {
          error: { code: 'UNAUTHORIZED', message: err.message, details: {} },
        });
        return;
      }

      if (err instanceof Error && err.message === 'INVALID_BODY') {
        sendJson(res, 400, {
          error: {
            code: 'INVALID_BODY',
            message: 'Тело запроса должно быть валидным JSON-объектом',
            details: {},
          },
        });
        return;
      }

      if (err instanceof Error && err.message === 'BODY_TOO_LARGE') {
        sendJson(res, 400, {
          error: {
            code: 'BODY_TOO_LARGE',
            message: 'Тело запроса превышает допустимый размер',
            details: {},
          },
        });
        return;
      }

      logger.error({ err, method: req.method, url: req.url }, 'Unhandled scheduler HTTP error');
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} },
        });
      }
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  adminApiToken: string,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';

  if (method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', service: 'scheduler' });
    return;
  }

  const runner = JOB_ROUTES[url.pathname];
  if (!runner || method !== 'POST') {
    sendJson(res, 404, {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${method} ${url.pathname} not found`,
        details: {},
      },
    });
    return;
  }

  requireAdminAuth(req, adminApiToken);
  const body = await readJsonBody(req);
  const options = parseJobOptions(body, url.searchParams);

  if (!options.force) {
    sendJson(res, 400, {
      error: {
        code: 'FORCE_REQUIRED',
        message: 'Для ручного запуска укажите force=true (query или JSON body)',
        details: { hint: 'POST ...?force=true или { "force": true }' },
      },
    });
    return;
  }

  logger.info({ path: url.pathname, options }, 'Ручной запуск scheduler job');
  const result = await runner(logger, options);
  sendJson(res, 200, result);
}
