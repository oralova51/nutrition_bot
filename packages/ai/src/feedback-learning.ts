// Процесс обновления промптов на основе обратной связи (roadmap 11.5).
// При низкой оценке создаёт запись в AIModelLog, чтобы аналитик скорректировал промпт.

import { AIModelLog, createLogger } from '@nutrition-bot/shared';
import { PROMPT_VERSION } from './prompts.js';

const logger = createLogger('ai-engine');

export interface LowFeedbackInput {
  rating: number;
  comment: string | null;
  clientId: string;
  source: 'course_final' | 'recommendation';
}

/**
 * Регистрирует низкую оценку как причину для пересмотра промптов.
 * В MVP промпт обновляется вручную аналитиком; запись в AIModelLog служит
 * входом для такого пересмотра.
 */
export async function recordPromptUpdateFromFeedback(input: LowFeedbackInput): Promise<void> {
  const reason = `Низкая оценка: ${input.rating} (источник: ${input.source})`;
  const comment = input.comment
    ? `Client: ${input.clientId}. Комментарий: ${input.comment}`
    : `Client: ${input.clientId}. Комментарий не предоставлен.`;

  try {
    await AIModelLog.create({
      version: PROMPT_VERSION,
      updateReason: reason,
      analystComment: comment,
    });
  } catch (err) {
    logger.error(
      { err, clientId: input.clientId, rating: input.rating },
      'Не удалось записать AIModelLog для низкой оценки',
    );
  }
}
