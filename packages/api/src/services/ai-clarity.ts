// Playground ИИ-уточнений (ФТ-22): тот же checkDiaryClarity, что вызывает бот
// при записи дневника, но без Telegram и без записи в БД.

import { createAIEngine, resolveAIConfig } from '@nutrition-bot/ai';
import type { ClarityCheckResult, ClarityMissingField } from '@nutrition-bot/ai';
import { DEFAULT_TIMEZONE } from '@nutrition-bot/shared';
import { ApiError } from '../http.js';
import { optionalString, requireString } from '../validation.js';

/** Совпадает с `nutrition-diary.ts`: что увидит клиент, если модель не дала вопрос. */
const CLARIFICATION_REQUEST_FALLBACK = 'Кажется, я не понял. Можете переформулировать?';
/** Совпадает с `nutrition-diary.ts`: подтверждение, когда уточнение не нужно. */
const CONFIRMATION_MESSAGE = 'Спасибо, записал! 🍽️';

export interface ClarityCheckPlaygroundResponse {
  needsClarification: boolean;
  missingFields: ClarityMissingField[];
  question: string | null;
  /** Текст, который бот отправил бы клиенту в Telegram. */
  botReply: string;
  /** Какой движок ответил: mock (эвристика) или openai-compatible (живая модель). */
  provider: 'mock' | 'openai-compatible';
}

export async function runClarityCheckPlayground(
  body: Record<string, unknown>,
): Promise<ClarityCheckPlaygroundResponse> {
  const description = requireString(body, 'description');
  const firstName = optionalString(body, 'firstName');
  const hasPhoto = optionalBoolean(body, 'hasPhoto');
  const approxCalories = optionalApproxCalories(body, 'approxCalories');
  const provider = resolveAIConfig().provider;

  let clarity: ClarityCheckResult;
  try {
    clarity = await createAIEngine().checkDiaryClarity({
      description,
      hasPhoto,
      approxCalories,
      clientContext: { firstName, timezone: DEFAULT_TIMEZONE },
    });
  } catch {
    // Как в боте (`resolveClarity`): сбой AI не должен спамить клиента уточнениями.
    clarity = { needsClarification: false, missingFields: [], question: null };
  }

  return {
    needsClarification: clarity.needsClarification,
    missingFields: clarity.missingFields,
    question: clarity.needsClarification ? clarity.question : null,
    botReply: clarity.needsClarification
      ? (clarity.question ?? CLARIFICATION_REQUEST_FALLBACK)
      : CONFIRMATION_MESSAGE,
    provider,
  };
}

function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ApiError(400, 'INVALID_BODY', `Поле "${field}" должно быть true или false`);
  }
  return value;
}

function optionalApproxCalories(body: Record<string, unknown>, field: string): number | null {
  const value = body[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ApiError(
      400,
      'INVALID_BODY',
      `Поле "${field}" должно быть положительным целым числом`,
    );
  }
  return value;
}
