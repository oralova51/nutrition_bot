// Мониторинг uptime API и алертинг администратору при недоступности (roadmap 11.4).

import type { Logger } from 'pino';
import { sendAdminAlert } from '@nutrition-bot/shared';

interface HealthPayload {
  status?: string;
  database?: string;
  version?: string;
  uptimeSeconds?: number;
}

const DEFAULT_HEALTH_URL = 'http://localhost:3000/api/v1/health';

function resolveHealthUrl(): string {
  return process.env.API_HEALTH_URL || DEFAULT_HEALTH_URL;
}

export async function runUptimeMonitorJob(logger: Logger): Promise<void> {
  const url = resolveHealthUrl();

  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      await alertAdmin(logger, `HTTP ${response.status} от ${url}`);
      return;
    }

    const payload = (await response.json()) as HealthPayload;
    if (payload.status !== 'ok' || payload.database !== 'connected') {
      await alertAdmin(
        logger,
        `API доступен, но health не ок\nstatus: ${payload.status ?? 'n/a'}\ndatabase: ${payload.database ?? 'n/a'}\nurl: ${url}`,
      );
      return;
    }

    logger.debug({ url, uptimeSeconds: payload.uptimeSeconds }, 'Uptime monitor: сервис здоров');
  } catch (err) {
    await alertAdmin(logger, `API недоступен: ${url}\nОшибка: ${formatError(err)}`);
  }
}

async function alertAdmin(logger: Logger, message: string): Promise<void> {
  logger.warn({ message }, 'Uptime monitor: зафиксирована проблема');
  try {
    await sendAdminAlert(`⚠️ Проблема с uptime\n\n${message}`);
  } catch (alertErr) {
    logger.error({ alertErr }, 'Uptime monitor: не удалось отправить алерт администратору');
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
