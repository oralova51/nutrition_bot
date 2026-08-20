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
  EveningSummaryInput,
  EveningSummaryResult,
  RecommendationProposal,
} from './types.js';
import type { AIConfig } from './config.js';
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildDiaryAnalysisUserPrompt,
  buildEveningSummaryUserPrompt,
  buildRecommendationUserPrompt,
  EVENING_SUMMARY_SYSTEM_PROMPT,
  RECOMMENDATION_SYSTEM_PROMPT,
} from './prompts.js';
import {
  buildHeuristicEveningSummary,
  composeEveningSummaryText,
} from './evening-summary-heuristic.js';
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
    const previousHistorySummary = this.buildPreviousHistorySummary(input);
    const userPrompt = buildDiaryAnalysisUserPrompt(
      input.entry.description,
      input.entry.hasPhoto,
      input.entry.approxCalories,
      historySummary,
      previousHistorySummary,
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

    // Пустая строка — реальный случай у reasoning-моделей, когда бюджет токенов
    // ушёл на thinking. `??` её не отсекает, поэтому проверяем на falsy:
    // иначе клиент получит пустое сообщение, а Telegram — ошибку доставки.
    const text = response.choices[0]?.message?.content?.trim();
    if (!text) {
      logger.warn(
        {
          model: this.config.model,
          criterion: proposal.criterion,
          finishReason: response.choices[0]?.finish_reason,
        },
        'AI вернул пустой текст рекомендации — отправляем черновик',
      );
      return proposal.draftText;
    }

    logger.info(
      { model: this.config.model, criterion: proposal.criterion, length: text.length },
      'AI: генерация текста рекомендации завершена',
    );
    return text;
  }

  async generateEveningSummary(input: EveningSummaryInput): Promise<EveningSummaryResult> {
    const entriesSummary = input.dayEntries
      .map((entry, index) => {
        const calories = entry.approxCalories !== null ? `, ~${entry.approxCalories} ккал` : '';
        const photo = entry.hasPhoto ? ', есть фото' : '';
        return `${index + 1}. ${entry.description ?? '(без описания)'}${calories}${photo}`;
      })
      .join('\n');

    const userPrompt = buildEveningSummaryUserPrompt(
      input.localDate,
      entriesSummary,
      input.clientContext,
    );

    const maxTokens = Math.max(this.config.eveningSummaryMaxTokens, this.config.maxTokens, 2048);

    logger.debug(
      {
        model: this.config.model,
        localDate: input.localDate,
        entries: input.dayEntries.length,
        maxTokens,
      },
      'Запрос к AI: вечерняя сводка',
    );

    await this.rateLimiter.acquire();

    let response;
    try {
      // thinking: disabled — у DeepSeek V4 reasoning иначе съедает почти весь max_tokens,
      // и JSON-сводка обрезается (finish_reason=length).
      response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: EVENING_SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: this.config.temperature,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    } catch (firstErr) {
      logger.warn(
        { err: firstErr, model: this.config.model, localDate: input.localDate },
        'Вечерняя сводка: запрос с thinking=disabled не прошёл, повторяю без него',
      );
      try {
        response = await this.client.chat.completions.create({
          model: this.config.model,
          messages: [
            { role: 'system', content: EVENING_SUMMARY_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature: this.config.temperature,
          response_format: { type: 'json_object' },
        });
      } catch (err) {
        logger.error(
          { err, model: this.config.model, localDate: input.localDate },
          'Ошибка при вызове AI: вечерняя сводка',
        );
        throw err;
      }
    }

    const finishReason = response.choices[0]?.finish_reason;
    const rawContent = response.choices[0]?.message?.content ?? '';
    let parsed: Partial<EveningSummaryResult> | null = null;
    try {
      parsed = JSON.parse(rawContent) as Partial<EveningSummaryResult>;
    } catch {
      logger.warn(
        {
          rawContentPreview: rawContent.slice(0, 500),
          model: this.config.model,
          localDate: input.localDate,
          finishReason,
          usage: response.usage,
        },
        'AI вернул некорректный JSON при вечерней сводке',
      );
    }

    if (finishReason === 'length') {
      logger.warn(
        {
          model: this.config.model,
          localDate: input.localDate,
          maxTokens,
          usage: response.usage,
        },
        'Вечерняя сводка обрезана по max_tokens',
      );
    }

    if (!parsed) {
      const fallback = buildHeuristicEveningSummary(
        input.dayEntries,
        input.localDate,
        input.clientContext,
      );
      return {
        ...fallback,
        metadata: {
          ...fallback.metadata,
          engine: 'openai-compatible-fallback',
          model: this.config.model,
          baseURL: this.config.baseURL,
          usage: response.usage,
          finishReason,
          reason: 'invalid_json',
        },
      };
    }

    const enough = Array.isArray(parsed.enough) ? parsed.enough.map(String) : [];
    const missing = Array.isArray(parsed.missing) ? parsed.missing.map(String) : [];
    const toAdd = Array.isArray(parsed.toAdd) ? parsed.toAdd.map(String) : [];
    const improvements = Array.isArray(parsed.improvements) ? parsed.improvements.map(String) : [];

    let summaryText =
      typeof parsed.summaryText === 'string' && parsed.summaryText.trim().length > 40
        ? parsed.summaryText.trim()
        : composeEveningSummaryText(
            input.localDate,
            enough,
            missing,
            toAdd,
            improvements,
            input.clientContext.firstName,
          );

    if (!summaryText) {
      const fallback = buildHeuristicEveningSummary(
        input.dayEntries,
        input.localDate,
        input.clientContext,
      );
      summaryText = fallback.summaryText;
      logger.warn(
        { localDate: input.localDate, model: this.config.model },
        'AI-сводка пустая — использован эвристический fallback по записям дня',
      );
      return {
        enough: enough.length > 0 ? enough : fallback.enough,
        missing: missing.length > 0 ? missing : fallback.missing,
        toAdd: toAdd.length > 0 ? toAdd : fallback.toAdd,
        improvements: improvements.length > 0 ? improvements : fallback.improvements,
        summaryText,
        metadata: {
          engine: 'openai-compatible-fallback',
          model: this.config.model,
          baseURL: this.config.baseURL,
          usage: response.usage,
          finishReason,
          reason: 'empty_summary',
        },
      };
    }

    logger.info(
      {
        model: this.config.model,
        localDate: input.localDate,
        entries: input.dayEntries.length,
        summaryLength: summaryText.length,
        usage: response.usage,
        finishReason,
      },
      'AI: вечерняя сводка завершена',
    );

    return {
      enough,
      missing,
      toAdd,
      improvements,
      summaryText,
      metadata: {
        engine: 'openai-compatible',
        model: this.config.model,
        baseURL: this.config.baseURL,
        usage: response.usage,
        finishReason,
      },
    };
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

  private buildPreviousHistorySummary(input: DiaryAnalysisInput): string | undefined {
    if (!input.previousHistory || input.previousHistory.length === 0) {
      return undefined;
    }
    return `Записей за предыдущий курс: ${input.previousHistory.length}. Последняя запись: ${input.previousHistory[0]?.description ?? '(без описания)'}.`;
  }
}
