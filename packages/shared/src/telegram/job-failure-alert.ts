// Алерты администратору о сбое job/фоновой обработки (рекомендации, вечерняя сводка).
// Best-effort: сбой самого алерта не прерывает работу. Дедуп — в памяти процесса,
// чтобы при падении провайдера не слать по сообщению на каждого клиента.

import { classifyProviderError } from '../errors/provider-error.js';
import { createLogger } from '../logging/logger.js';
import { sendAdminAlert } from './alerts.js';

const logger = createLogger('telegram-alerts');

export type JobFailureKind = 'recommendation' | 'evening_summary';

export interface JobFailureAlertState {
  lastSentAt: Map<string, number>;
}

export function createJobFailureAlertState(): JobFailureAlertState {
  return { lastSentAt: new Map() };
}

const sharedAlertState = createJobFailureAlertState();

export interface JobFailureAlertInput {
  kind: JobFailureKind;
  clientId?: string;
  entryId?: string;
  err?: unknown;
  /** Клиент всё же получил запасной текст, полноценная AI-сводка не собралась. */
  usedFallback?: boolean;
}

export interface JobFailureIssue {
  clientId: string;
  err?: unknown;
  usedFallback?: boolean;
}

function resolveIntervalMs(): number {
  const raw = process.env.JOB_FAILURE_ALERT_INTERVAL_MINUTES;
  if (!raw) return 60 * 60 * 1000;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return 60 * 60 * 1000;
  return parsed * 60 * 1000;
}

function escapeAlertText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cooldownKey(kind: JobFailureKind, errorClass: string, clientId?: string): string {
  if (errorClass === 'unknown' && clientId) {
    return `${kind}:${errorClass}:${clientId}`;
  }
  return `${kind}:${errorClass}`;
}

function shouldSend(state: JobFailureAlertState, key: string): boolean {
  const last = state.lastSentAt.get(key);
  if (last === undefined) return true;
  return Date.now() - last >= resolveIntervalMs();
}

function kindTitle(kind: JobFailureKind, usedFallback: boolean): string {
  if (kind === 'recommendation') {
    return 'Рекомендация не создана';
  }
  if (usedFallback) {
    return 'Вечерняя сводка: AI недоступен, клиент получил запасной текст';
  }
  return 'Вечерняя сводка не собралась — отчёта нет';
}

function formatIssueLines(issues: JobFailureIssue[]): string[] {
  const classified = issues.map((issue) => ({
    ...issue,
    classified: classifyProviderError(issue.err),
  }));
  const primary = classified[0]?.classified;
  const reason = primary?.reason ?? 'неизвестная ошибка при работе с AI или данными';
  const detail = primary?.detail ?? 'нет текста ошибки';
  const hardFailures = classified.filter((item) => item.usedFallback !== true);
  const fallbacks = classified.filter((item) => item.usedFallback === true);

  const lines = [
    `Причина: ${escapeAlertText(reason)}`,
    `Ошибка: <code>${escapeAlertText(detail)}</code>`,
  ];

  if (hardFailures.length > 0) {
    const ids = hardFailures
      .map((item) => `<code>${escapeAlertText(item.clientId)}</code>`)
      .join(', ');
    lines.push(`Не собралась (отчёта нет): <b>${hardFailures.length}</b> — ${ids}`);
  }
  if (fallbacks.length > 0) {
    const ids = fallbacks
      .map((item) => `<code>${escapeAlertText(item.clientId)}</code>`)
      .join(', ');
    lines.push(`Ушла запасная сводка: <b>${fallbacks.length}</b> — ${ids}`);
  }

  return lines;
}

async function dispatchAlert(
  text: string,
  state: JobFailureAlertState,
  key: string,
  logFields: Record<string, unknown>,
): Promise<void> {
  if (!shouldSend(state, key)) {
    logger.info({ ...logFields, key }, 'Алерт о сбое job уже отправляли недавно, пропускаем');
    return;
  }

  try {
    await sendAdminAlert(text);
    state.lastSentAt.set(key, Date.now());
    logger.warn(logFields, 'Администратору отправлен алерт о сбое job');
  } catch (alertErr) {
    logger.error(
      { ...logFields, alertErr },
      'Не удалось отправить алерт администратору о сбое job',
    );
  }
}

/**
 * Один сбой (анализ дневника, запись после 21:00).
 * Инфраструктурные ошибки (биллинг/auth/rate limit) дедупятся глобально.
 */
export async function notifyAdminJobFailure(
  input: JobFailureAlertInput,
  state: JobFailureAlertState = sharedAlertState,
): Promise<void> {
  const classified = classifyProviderError(input.err);
  const key = cooldownKey(input.kind, classified.class, input.clientId);
  const usedFallback = input.usedFallback === true;
  const lines = [
    `⚠️ ${kindTitle(input.kind, usedFallback)}`,
    '',
    `Причина: ${escapeAlertText(classified.reason)}`,
  ];
  if (input.clientId) {
    lines.push(`Client: <code>${escapeAlertText(input.clientId)}</code>`);
  }
  if (input.entryId) {
    lines.push(`Запись дневника: <code>${escapeAlertText(input.entryId)}</code>`);
  }
  lines.push(`Ошибка: <code>${escapeAlertText(classified.detail)}</code>`);

  await dispatchAlert(lines.join('\n'), state, key, {
    kind: input.kind,
    clientId: input.clientId ?? null,
    errorClass: classified.class,
    usedFallback,
  });
}

/**
 * Пачка сбоев за один прогон evening-summary job: один алерт вместо N.
 */
export async function notifyAdminJobFailuresDigest(
  kind: JobFailureKind,
  issues: JobFailureIssue[],
  state: JobFailureAlertState = sharedAlertState,
): Promise<void> {
  if (issues.length === 0) return;

  const primary = classifyProviderError(issues[0]?.err);
  const hasHardFailure = issues.some((issue) => issue.usedFallback !== true);
  const hasFallback = issues.some((issue) => issue.usedFallback === true);
  const usedFallback = hasFallback && !hasHardFailure;
  const title =
    kind === 'evening_summary' && hasHardFailure && hasFallback
      ? 'Проблема с вечерней сводкой'
      : kindTitle(kind, usedFallback);
  const key = cooldownKey(kind, primary.class);
  const lines = [`⚠️ ${title}`, '', ...formatIssueLines(issues)];

  await dispatchAlert(lines.join('\n'), state, key, {
    kind,
    count: issues.length,
    errorClass: primary.class,
    usedFallback,
  });
}
