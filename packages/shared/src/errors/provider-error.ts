// Классификация ошибок внешнего AI-провайдера для понятных алертов администратору.
// Не зависит от SDK: смотрим status/code/текст, как их отдают OpenAI-compatible API.

export type ProviderErrorClass = 'billing' | 'auth' | 'rate_limit' | 'provider' | 'unknown';

export interface ClassifiedProviderError {
  class: ProviderErrorClass;
  /** Короткая причина для человека, без сырого JSON провайдера. */
  reason: string;
  detail: string;
}

const BILLING_CODE_MARKERS = [
  'insufficient_quota',
  'insufficient_funds',
  'billing_not_active',
  'billing_hard_limit_reached',
  'payment_required',
];

const BILLING_TEXT_MARKERS = [
  'insufficient_quota',
  'insufficient quota',
  'exceeded your current quota',
  'quota exceeded',
  'billing hard limit',
  'billing_not_active',
  'payment required',
  'credit balance',
  'out of credits',
  'недостаточно средств',
  'закончились деньги',
  'недостаточно денег',
];

const AUTH_CODE_MARKERS = ['invalid_api_key', 'invalid_api_token', 'authentication_error'];

const AUTH_TEXT_MARKERS = [
  'invalid_api_key',
  'invalid api key',
  'incorrect api key',
  'unauthorized',
  'authentication',
  'invalid token',
];

const RATE_LIMIT_CODE_MARKERS = ['rate_limit_exceeded', 'rate_limit_error', 'too_many_requests'];

const RATE_LIMIT_TEXT_MARKERS = ['rate limit', 'too many requests', 'rate_limit_exceeded'];

const PROVIDER_TEXT_MARKERS = [
  'econnrefused',
  'etimedout',
  'enotfound',
  'fetch failed',
  'network',
  'socket hang up',
  'service unavailable',
  'bad gateway',
  'gateway timeout',
];

export function classifyProviderError(err: unknown): ClassifiedProviderError {
  const shape = extractErrorShape(err);
  const haystack = `${shape.code} ${shape.type} ${shape.detail}`.toLowerCase();

  if (
    shape.status === 402 ||
    hasMarker(shape.code, BILLING_CODE_MARKERS) ||
    hasMarker(haystack, BILLING_TEXT_MARKERS)
  ) {
    return {
      class: 'billing',
      reason: 'закончились деньги на счёте AI-провайдера (квота/биллинг)',
      detail: shape.detail,
    };
  }

  if (
    shape.status === 401 ||
    hasMarker(shape.code, AUTH_CODE_MARKERS) ||
    hasMarker(haystack, AUTH_TEXT_MARKERS)
  ) {
    return {
      class: 'auth',
      reason: 'ключ AI-провайдера отклонён (проверьте AI_API_KEY)',
      detail: shape.detail,
    };
  }

  if (
    (shape.status === 429 && !hasMarker(haystack, BILLING_TEXT_MARKERS)) ||
    hasMarker(shape.code, RATE_LIMIT_CODE_MARKERS) ||
    hasMarker(haystack, RATE_LIMIT_TEXT_MARKERS)
  ) {
    return {
      class: 'rate_limit',
      reason: 'AI-провайдер ограничил частоту запросов (rate limit)',
      detail: shape.detail,
    };
  }

  if (
    (shape.status !== undefined && shape.status >= 500) ||
    hasMarker(haystack, PROVIDER_TEXT_MARKERS)
  ) {
    return {
      class: 'provider',
      reason: 'AI-провайдер недоступен',
      detail: shape.detail,
    };
  }

  return {
    class: 'unknown',
    reason: 'неизвестная ошибка при работе с AI или данными',
    detail: shape.detail,
  };
}

function extractErrorShape(err: unknown): {
  status?: number;
  code?: string;
  type?: string;
  detail: string;
} {
  if (err === undefined || err === null) {
    return { detail: 'нет текста ошибки' };
  }

  if (typeof err === 'string') {
    return { detail: truncate(err) };
  }

  if (err instanceof Error) {
    const extra = err as Error & { status?: unknown; code?: unknown; type?: unknown };
    return {
      status: asStatus(extra.status) ?? asStatus(readNested(err, 'status')),
      code: asString(extra.code) ?? asString(readNested(err, 'code')),
      type: asString(extra.type) ?? asString(readNested(err, 'type')),
      detail: truncate(`${err.name}: ${err.message}`),
    };
  }

  if (typeof err === 'object') {
    const record = err as Record<string, unknown>;
    const nested =
      typeof record.error === 'object' && record.error !== null
        ? (record.error as Record<string, unknown>)
        : undefined;
    const message =
      asString(record.message) ?? asString(nested?.message) ?? truncate(JSON.stringify(record));
    return {
      status: asStatus(record.status) ?? asStatus(nested?.status),
      code: asString(record.code) ?? asString(nested?.code),
      type: asString(record.type) ?? asString(nested?.type),
      detail: truncate(message),
    };
  }

  if (typeof err === 'number' || typeof err === 'boolean' || typeof err === 'bigint') {
    return { detail: truncate(String(err)) };
  }

  return { detail: 'неразборчивая ошибка' };
}

function readNested(err: Error, key: string): unknown {
  if (!(key in err)) return undefined;
  return (err as unknown as Record<string, unknown>)[key];
}

function asStatus(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value < 600) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 100 && parsed < 600) return parsed;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasMarker(haystack: string | undefined, markers: string[]): boolean {
  if (!haystack) return false;
  const lower = haystack.toLowerCase();
  return markers.some((marker) => lower.includes(marker));
}

function truncate(text: string, max = 400): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
