// Dashboard-роуты для администратора и специалиста (roadmap 9.4–9.9, 9.12–9.16).
// См. SA/stage9-dashboards.md для контрактов и Postman-коллекции.

import {
  NUTRITION_DIARY_STATUSES,
  RENEWAL_OFFER_STATUSES,
  REPORT_TYPES,
} from '@nutrition-bot/shared';
import { ApiError, sendCsv, sendJson } from '../http.js';
import type { RouteContext, RouteDefinition } from '../router.js';
import {
  exportClientsCsv,
  getActivityStatistics,
  getClientCompliance,
  getRecommendationsStatistics,
  getTopNutritionProblems,
  listClientFeedback,
  listClientReports,
  listCriticalFeedback,
  listEnrollmentDiary,
  listFailedMessages,
  listRenewalOffers,
} from '../services/dashboards.js';
import {
  MAX_LIMIT,
  parseBooleanParam,
  parseDateRange,
  parseEnumParam,
  parsePagination,
  parsePositiveIntParam,
} from '../validation.js';
import type { ClientListFilters } from '../services/clients.js';

function requireEnrollmentId(params: Record<string, string>): string {
  const enrollmentId = params.enrollmentId;
  if (!enrollmentId) {
    throw new ApiError(400, 'INVALID_PARAMS', 'enrollmentId обязателен в пути запроса');
  }
  return enrollmentId;
}

function requireClientId(params: Record<string, string>): string {
  const clientId = params.clientId;
  if (!clientId) {
    throw new ApiError(400, 'INVALID_PARAMS', 'clientId обязателен в пути запроса');
  }
  return clientId;
}

const DEFAULT_TOP_PROBLEMS_LIMIT = 10;

export function createAdminDashboardRoutes(botUsername: string): RouteDefinition[] {
  return [
    {
      method: 'GET',
      pattern: '/admin/enrollments/:enrollmentId/diary',
      requiresAdminAuth: true,
      handler: async ({ res, params, query }: RouteContext): Promise<void> => {
        const enrollmentId = requireEnrollmentId(params);
        const result = await listEnrollmentDiary(
          enrollmentId,
          {
            status: parseEnumParam(query, 'status', NUTRITION_DIARY_STATUSES),
            ...parseDateRange(query),
          },
          parsePagination(query),
        );
        sendJson(res, 200, result);
      },
    },
    {
      method: 'GET',
      pattern: '/admin/statistics/recommendations',
      requiresAdminAuth: true,
      handler: async ({ res, query }: RouteContext): Promise<void> => {
        const result = await getRecommendationsStatistics({
          courseId: query.get('courseId') ?? undefined,
          ...parseDateRange(query),
        });
        sendJson(res, 200, result);
      },
    },
    {
      method: 'GET',
      pattern: '/admin/feedback/critical',
      requiresAdminAuth: true,
      handler: async ({ res, query }: RouteContext): Promise<void> => {
        const result = await listCriticalFeedback(
          { unresolvedOnly: parseBooleanParam(query, 'unresolvedOnly') },
          parsePagination(query),
        );
        sendJson(res, 200, result);
      },
    },
    {
      method: 'GET',
      pattern: '/admin/renewal-offers',
      requiresAdminAuth: true,
      handler: async ({ res, query }: RouteContext): Promise<void> => {
        const result = await listRenewalOffers(
          { status: parseEnumParam(query, 'status', RENEWAL_OFFER_STATUSES) },
          parsePagination(query),
        );
        sendJson(res, 200, result);
      },
    },
    {
      method: 'GET',
      pattern: '/admin/export/clients',
      requiresAdminAuth: true,
      handler: async ({ res, query }: RouteContext): Promise<void> => {
        const format = query.get('format') ?? 'csv';
        if (format !== 'csv') {
          throw new ApiError(
            400,
            'NOT_SUPPORTED',
            'В MVP поддерживается только формат csv; xlsx запланирован в post-MVP',
          );
        }
        const filters: ClientListFilters = {
          status: parseEnumParam(query, 'status', ['active', 'inactive', 'all'] as const),
          enrollmentStatus: parseEnumParam(query, 'enrollmentStatus', [
            'active',
            'paused',
            'completed',
            'cancelled',
          ] as const),
          onboardingStatus: parseEnumParam(query, 'onboardingStatus', [
            'pending',
            'in_progress',
            'settings_pending',
            'completed',
          ] as const),
        };
        const { filename, content } = await exportClientsCsv(filters, botUsername);
        sendCsv(res, 200, filename, content);
      },
    },
    {
      method: 'GET',
      pattern: '/admin/messages/failed',
      requiresAdminAuth: true,
      handler: async ({ res, query }: RouteContext): Promise<void> => {
        const result = await listFailedMessages(
          { exhaustedRetries: parseBooleanParam(query, 'exhaustedRetries') },
          parsePagination(query),
        );
        sendJson(res, 200, result);
      },
    },
  ];
}

export function createSpecialistDashboardRoutes(): RouteDefinition[] {
  return [
    {
      method: 'GET',
      pattern: '/specialist/clients/:clientId/reports',
      requiresAdminAuth: true,
      handler: async ({ res, params, query }: RouteContext): Promise<void> => {
        const clientId = requireClientId(params);
        const result = await listClientReports(
          clientId,
          { type: parseEnumParam(query, 'type', REPORT_TYPES) },
          parsePagination(query),
        );
        sendJson(res, 200, result);
      },
    },
    {
      method: 'GET',
      pattern: '/specialist/clients/:clientId/compliance',
      requiresAdminAuth: true,
      handler: async ({ res, params }: RouteContext): Promise<void> => {
        const clientId = requireClientId(params);
        const result = await getClientCompliance(clientId);
        sendJson(res, 200, result);
      },
    },
    {
      method: 'GET',
      pattern: '/specialist/statistics/problems',
      requiresAdminAuth: true,
      handler: async ({ res, query }: RouteContext): Promise<void> => {
        const result = await getTopNutritionProblems(
          parseDateRange(query),
          parsePositiveIntParam(query, 'limit', DEFAULT_TOP_PROBLEMS_LIMIT, MAX_LIMIT),
        );
        sendJson(res, 200, result);
      },
    },
    {
      method: 'GET',
      pattern: '/specialist/statistics/activity',
      requiresAdminAuth: true,
      handler: async ({ res, query }: RouteContext): Promise<void> => {
        const minFillRateRaw = query.get('minFillRate');
        let minFillRate: number | undefined;
        if (minFillRateRaw !== null) {
          const value = Number.parseInt(minFillRateRaw, 10);
          if (
            !Number.isInteger(value) ||
            value < 0 ||
            value > 100 ||
            String(value) !== minFillRateRaw
          ) {
            throw new ApiError(
              400,
              'INVALID_PARAMS',
              'Параметр "minFillRate" должен быть целым числом от 0 до 100',
            );
          }
          minFillRate = value;
        }
        const result = await getActivityStatistics(parseDateRange(query), minFillRate);
        sendJson(res, 200, result);
      },
    },
    {
      method: 'GET',
      pattern: '/specialist/clients/:clientId/feedback',
      requiresAdminAuth: true,
      handler: async ({ res, params, query }: RouteContext): Promise<void> => {
        const clientId = requireClientId(params);
        const result = await listClientFeedback(clientId, parsePagination(query));
        sendJson(res, 200, result);
      },
    },
  ];
}
