/**
 * Реальный адаптер AIEngine для OpenAI-compatible API.
 * Подходит для локальных моделей (Ollama, vLLM, LM Studio и т.д.).
 * Roadmap 5.1: абстракция; 5.3 / 5.9: реальные промпты.
 */

import OpenAI from 'openai';
import type {
  AIEngine,
  ClientContext,
  DiaryAnalysisInput,
  DiaryAnalysisResult,
  RecommendationProposal,
} from './types.js';
import type { AIConfig } from './config.js';
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildDiaryAnalysisUserPrompt,
  buildRecommendationUserPrompt,
  RECOMMENDATION_SYSTEM_PROMPT,
} from './prompts.js';
import { logger } from './logger.js';
import { RateLimiter } from './rate-limiter.js';

export class OpenAICompatibleAIEngine implements AIEngine {
  private readonly client: OpenAI;
  private readonly config: AIConfig;
  private readonly rateLimiter: RateLimiter;

  constructor(config: AIConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter({ requestsPerMinute: config.rateLimitPerMinute });
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.requestTimeoutMs,
    });
  }

  async analyzeDiary(input: DiaryAnalysisInput): Promise<DiaryAnalysisResult> {
    const historySummary = this.buildHistorySummary(input);
    const userPrompt = buildDiaryAnalysisUserPrompt(
      input.entry.description,
      input.entry.hasPhoto,
      input.entry.approxCalories,
      historySummary,
      input.clientContext,
    );

    logger.debug(
      { model: this.config.model, entryId: input.entry.id },
      'Запрос к AI: анализ дневника',
    );

    await this.rateLimiter.acquire();

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        response_format: { type: 'json_object' },
      });
    } catch (err) {
      logger.error(
        { err, model: this.config.model, entryId: input.entry.id },
        'Ошибка при вызове AI: анализ дневника',
      );
      throw err;
    }

    const rawContent = response.choices[0]?.message?.content ?? '';
    let parsed: Partial<DiaryAnalysisResult>;

    try {
      parsed = JSON.parse(rawContent) as Partial<DiaryAnalysisResult>;
    } catch {
      logger.warn(
        { rawContent, model: this.config.model, entryId: input.entry.id },
        'AI вернул некорректный JSON при анализе дневника',
      );
      parsed = { proposals: [] };
    }

    const proposals = (parsed.proposals ?? []).map((proposal) => ({
      ...proposal,
      id: proposal.id ?? crypto.randomUUID(),
    }));

    logger.info(
      {
        model: this.config.model,
        entryId: input.entry.id,
        proposalCount: proposals.length,
        usage: response.usage,
      },
      'AI: анализ дневника завершён',
    );

    return {
      proposals,
      metadata: {
        engine: 'openai-compatible',
        model: this.config.model,
        baseURL: this.config.baseURL,
        usage: response.usage,
        finishReason: response.choices[0]?.finish_reason,
      },
    };
  }

  async generateRecommendationText(
    proposal: RecommendationProposal,
    context: ClientContext,
  ): Promise<string> {
    const userPrompt = buildRecommendationUserPrompt(proposal, context);

    logger.debug(
      { model: this.config.model, criterion: proposal.criterion },
      'Запрос к AI: генерация текста рекомендации',
    );

    await this.rateLimiter.acquire();

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: RECOMMENDATION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });
    } catch (err) {
      logger.error(
        { err, model: this.config.model, criterion: proposal.criterion },
        'Ошибка при вызове AI: генерация текста рекомендации',
      );
      return proposal.draftText;
    }

    const text = response.choices[0]?.message?.content?.trim() ?? proposal.draftText;
    logger.info(
      { model: this.config.model, criterion: proposal.criterion, length: text.length },
      'AI: генерация текста рекомендации завершена',
    );
    return text;
  }

  private buildHistorySummary(input: DiaryAnalysisInput): string {
    const today = new Date();
    const dayEntries = input.history.filter((entry) => {
      const entryDate = new Date(entry.mealAt);
      return (
        entryDate.getUTCFullYear() === today.getUTCFullYear() &&
        entryDate.getUTCMonth() === today.getUTCMonth() &&
        entryDate.getUTCDate() === today.getUTCDate()
      );
    });

    return [
      `За сегодня записей: ${dayEntries.length}`,
      `Всего записей за курс: ${input.history.length}`,
      input.questionnaire ? 'Анкета клиента заполнена.' : 'Анкета не заполнена.',
    ].join('\n');
  }
}
