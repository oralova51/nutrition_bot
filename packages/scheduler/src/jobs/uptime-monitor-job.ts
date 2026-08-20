// Мониторинг uptime API и алертинг администратору при недоступности (roadmap 11.4).
// Локальный URL / пустой API_HEALTH_URL не алертят: это шум при разработке
// и ложные срабатывания, если переменная забыта на проде.

import type { Logger } from 'pino';
import { sendAdminAlert } from '@nutrition-bot/shared';

interface HealthPayload {
  status?: string;
  database?: string;
  version?: string;
  uptimeSeconds?: number;
}

export function resolveHealthUrl(): string | undefined {
  const raw = process.env.API_HEALTH_URL?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

export function isRemoteHealthUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1';
  } catch {
    return false;
  }
}

export async function runUptimeMonitorJob(logger: Logger): Promise<void> {
  const url = resolveHealthUrl();
  if (!url || !isRemoteHealthUrl(url)) {
    logger.debug(
      { url: url ?? null },
      'Uptime monitor: пропуск (задайте публичный API_HEALTH_URL)',
    );
    return;
  }

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
