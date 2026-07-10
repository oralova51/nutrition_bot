// Общие утилиты валидации тела запроса и query-параметров для admin-эндпоинтов.
// Единое место для правил разбора, чтобы роуты не дублировали проверки.

import { ApiError } from './http.js';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function requireObjectBody(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_BODY', 'Тело запроса должно быть JSON-объектом');
  }
  return body as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(
      400,
      'INVALID_BODY',
      `Поле "${field}" обязательно и должно быть непустой строкой`,
    );
  }
  return value.trim();
}

export function optionalString(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'INVALID_BODY', `Поле "${field}" должно быть непустой строкой`);
  }
  return value.trim();
}

export function requirePositiveInteger(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ApiError(
      400,
      'INVALID_BODY',
      `Поле "${field}" обязательно и должно быть положительным целым числом`,
    );
  }
  return value;
}

/** Проверяет строгий формат `YYYY-MM-DD` и то, что дата реально существует (без переноса, например 2026-02-30). */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function requireIsoDate(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !isValidIsoDate(value)) {
    throw new ApiError(
      400,
      'INVALID_BODY',
      `Поле "${field}" обязательно и должно быть датой в формате YYYY-MM-DD`,
    );
  }
  return value;
}

/** Прибавляет календарные дни к дате в формате `YYYY-MM-DD`, возвращает в том же формате (UTC). */
export function addDaysToIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface PaginationParams {
  page: number;
  limit: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePositiveIntParam(
  query: URLSearchParams,
  field: string,
  defaultValue: number,
): number {
  const raw = query.get(field);
  if (raw === null || raw === '') {
    return defaultValue;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || String(value) !== raw) {
    throw new ApiError(
      400,
      'INVALID_PARAMS',
      `Параметр "${field}" должен быть положительным целым числом`,
    );
  }
  return value;
}

/** adminAPI.md §4.3: page (default 1), limit (default 20, max 100). */
export function parsePagination(query: URLSearchParams): PaginationParams {
  const page = parsePositiveIntParam(query, 'page', DEFAULT_PAGE);
  const limit = Math.min(parsePositiveIntParam(query, 'limit', DEFAULT_LIMIT), MAX_LIMIT);
  return { page, limit };
}

export function parseEnumParam<T extends string>(
  query: URLSearchParams,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const raw = query.get(field);
  if (raw === null) {
    return undefined;
  }
  if (!allowed.includes(raw as T)) {
    throw new ApiError(
      400,
      'INVALID_PARAMS',
      `Параметр "${field}" должен быть одним из: ${allowed.join(', ')}`,
    );
  }
  return raw as T;
}

export function parseBooleanParam(query: URLSearchParams, field: string): boolean | undefined {
  const raw = query.get(field);
  if (raw === null) {
    return undefined;
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  throw new ApiError(400, 'INVALID_PARAMS', `Параметр "${field}" должен быть true или false`);
}

/** BIGINT в PostgreSQL хранится строкой (см. модели) — на границе API отдаём числом, как в adminAPI.md примерах. */
export function toNullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}
