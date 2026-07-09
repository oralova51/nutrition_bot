// HTTP-сервер API: маршрутизация и обработка запросов.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { Logger } from 'pino';
import { getHealthStatus } from './health.js';

const HEALTH_PATH = '/api/v1/health';

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function handleHealth(res: ServerResponse): Promise<void> {
  const payload = await getHealthStatus();
  const statusCode = payload.status === 'ok' ? 200 : 503;
  sendJson(res, statusCode, payload);
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === HEALTH_PATH) {
    await handleHealth(res);
    return;
  }

  sendJson(res, 404, {
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method ?? 'GET'} ${url.pathname} not found`,
      details: {},
    },
  });

  logger.warn({ method: req.method, path: url.pathname }, 'Route not found');
}

export function createApiServer(logger: Logger): Server {
  const server = createServer((req, res) => {
    void handleRequest(req, res, logger).catch((err: unknown) => {
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
