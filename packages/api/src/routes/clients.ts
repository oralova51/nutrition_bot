// Роуты клиентов — adminAPI.md §4.3.

import { CLIENT_ENROLLMENT_STATUSES, ONBOARDING_STATUSES } from '@nutrition-bot/shared';
import { readJsonBody, sendJson } from '../http.js';
import type { RouteContext, RouteDefinition } from '../router.js';
import {
  createClientWithEnrollment,
  getClientDetail,
  listClients,
  serializeCreatedClient,
  type ClientListFilters,
} from '../services/clients.js';
import {
  optionalString,
  parseBooleanParam,
  parseEnumParam,
  parsePagination,
  requireIsoDate,
  requireObjectBody,
  requireString,
} from '../validation.js';
import { ApiError } from '../http.js';

const CLIENT_STATUS_VALUES = ['active', 'inactive', 'all'] as const;
const LINK_STATUS_VALUES = ['no_link', 'active', 'expired', 'used'] as const;
const SORT_VALUES = ['registeredAt', 'lastInteractionAt', 'enrollmentEndDate'] as const;
const ORDER_VALUES = ['asc', 'desc'] as const;

function requireClientId(params: Record<string, string>): string {
  const clientId = params.clientId;
  if (!clientId) {
    throw new ApiError(400, 'INVALID_PARAMS', 'clientId обязателен в пути запроса');
  }
  return clientId;
}

function parseListFilters(query: URLSearchParams): ClientListFilters {
  return {
    status: parseEnumParam(query, 'status', CLIENT_STATUS_VALUES),
    enrollmentStatus: parseEnumParam(query, 'enrollmentStatus', CLIENT_ENROLLMENT_STATUSES),
    onboardingStatus: parseEnumParam(query, 'onboardingStatus', ONBOARDING_STATUSES),
    hasTelegram: parseBooleanParam(query, 'hasTelegram'),
    linkStatus: parseEnumParam(query, 'linkStatus', LINK_STATUS_VALUES),
    sort: parseEnumParam(query, 'sort', SORT_VALUES),
    order: parseEnumParam(query, 'order', ORDER_VALUES),
  };
}

/** @param botUsername username бота (без @) для построения deep link в списке клиентов. */
export function createClientRoutes(botUsername: string): RouteDefinition[] {
  return [
    {
      method: 'POST',
      pattern: '/admin/clients',
      requiresAdminAuth: true,
      handler: async ({ req, res }: RouteContext): Promise<void> => {
        const body = requireObjectBody(await readJsonBody(req));

        const result = await createClientWithEnrollment({
          firstName: requireString(body, 'firstName'),
          lastName: requireString(body, 'lastName'),
          email: optionalString(body, 'email'),
          phone: optionalString(body, 'phone'),
          courseId: requireString(body, 'courseId'),
          enrollmentStartDate: requireIsoDate(body, 'enrollmentStartDate'),
        });

        sendJson(res, 201, serializeCreatedClient(result));
      },
    },
    {
      method: 'GET',
      pattern: '/admin/clients',
      requiresAdminAuth: true,
      handler: async ({ res, query }: RouteContext): Promise<void> => {
        const filters = parseListFilters(query);
        const pagination = parsePagination(query);
        const result = await listClients(filters, pagination, botUsername);
        sendJson(res, 200, result);
      },
    },
    {
      method: 'GET',
      pattern: '/admin/clients/:clientId',
      requiresAdminAuth: true,
      handler: async ({ res, params }: RouteContext): Promise<void> => {
        const clientId = requireClientId(params);
        const detail = await getClientDetail(clientId);
        sendJson(res, 200, detail);
      },
    },
  ];
}
