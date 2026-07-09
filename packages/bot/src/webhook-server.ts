// HTTP-сервер для приёма Telegram-обновлений в режиме webhook (prod).
// adminAPI.md §6.1, §9 (п.3): webhook + secret_token.

import { createServer, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { Bot } from 'grammy';
import { webhookCallback } from 'grammy';
import type { Logger } from 'pino';

export interface WebhookServerOptions {
  /** Путь, на который Telegram будет присылать POST-запросы (из WEBHOOK_URL). */
  path: string;
  secretToken: string;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createWebhookServer(
  bot: Bot,
  options: WebhookServerOptions,
  logger: Logger,
): Server {
  const handleUpdate = webhookCallback(bot, 'http', { secretToken: options.secretToken });

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method !== 'POST' || url.pathname !== options.path) {
      sendJson(res, 404, {
        error: {
          code: 'NOT_FOUND',
          message: `Route ${req.method ?? 'GET'} ${url.pathname} not found`,
          details: {},
        },
      });
      return;
    }

    void handleUpdate(req, res).catch((err: unknown) => {
      logger.error({ err }, 'Ошибка обработки webhook-запроса Telegram');
      if (!res.writableEnded) {
        sendJson(res, 500, {
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} },
        });
      }
    });
  });
}
