// Playground ИИ-уточнений для локальной проверки ФТ-22 через Postman.
// Не пишет в БД и не шлёт сообщения в Telegram.

import { readJsonBody, sendJson } from '../http.js';
import type { RouteContext, RouteDefinition } from '../router.js';
import { runClarityCheckPlayground } from '../services/ai-clarity.js';
import { requireObjectBody } from '../validation.js';

export function createAiClarityRoutes(): RouteDefinition[] {
  return [
    {
      method: 'POST',
      pattern: '/internal/ai/clarity-check',
      requiresAdminAuth: true,
      handler: async ({ req, res }: RouteContext): Promise<void> => {
        const body = requireObjectBody(await readJsonBody(req));
        const result = await runClarityCheckPlayground(body);
        sendJson(res, 200, result);
      },
    },
  ];
}
