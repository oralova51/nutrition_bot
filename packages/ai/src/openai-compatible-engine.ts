/**
 * Реальный адаптер AIEngine для OpenAI-compatible API.
 * Подходит для локальных моделей (Ollama, vLLM, LM Studio и т.д.).
 * Roadmap 5.1: абстракция; 5.3 / 5.9: реальные промпты.
 */

import OpenAI from 'openai';
import type {
  AIEngine,
  ClarityCheckInput,
  ClarityCheckResult,
  ClarityMissingField,
  ClientContext,
  DiaryAnalysisInput,
  DiaryAnalysisResult,
  EveningSummaryInput,
  EveningSummaryResult,
  RecommendationProposal,
  TopProductsInput,
  TopProductsResult,
} from './types.js';
import type { AIConfig } from './config.js';
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildClarityCheckUserPrompt,
  buildDiaryAnalysisUserPrompt,
  buildEveningSummaryUserPrompt,
  buildRecommendationUserPrompt,
  CLARITY_CHECK_SYSTEM_PROMPT,
  EVENING_SUMMARY_SYSTEM_PROMPT,
  RECOMMENDATION_SYSTEM_PROMPT,
  TOP_PRODUCTS_SYSTEM_PROMPT,
  buildTopProductsUserPrompt,
} from './prompts.js';
import {
  buildHeuristicEveningSummary,
  composeEveningSummaryText,
} from './evening-summary-heuristic.js';
import {
  DEFAULT_TOP_PRODUCTS_LIMIT,
  extractTopProductsHeuristic,
  finalizeTopProducts,
  formatDiaryEntriesForTopProducts,
} from './top-products.js';
import { buildHistorySummary } from './history-summary.js';
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
    const historySummary = buildHistorySummary(input);
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
          'Ошибка при вызове AI: вечерняя сводка — отправляем эвристический fallback',
        );
        return this.eveningSummaryFallback(input, 'provider_error', { err });
      }
    }

    const finishReason = response.choices[0]?.finish_reason;
    const rawContent = response.choices[0]?.message?.content ?? '';
    let parsed: Partial<EveningSummaryResult> | null = null;
    try {
      parsed = JSON.parse(extractJson(rawContent)) as Partial<EveningSummaryResult>;
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
      return this.eveningSummaryFallback(input, 'invalid_json', {
        usage: response.usage,
        finishReason,
      });
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

  async checkDiaryClarity(input: ClarityCheckInput): Promise<ClarityCheckResult> {
    const userPrompt = buildClarityCheckUserPrompt(
      input.description,
      input.hasPhoto ?? false,
      input.approxCalories ?? null,
      input.clientContext,
    );

    logger.debug(
      { model: this.config.model, description: input.description.slice(0, 100) },
      'Запрос к AI: проверка полноты записи дневника',
    );

    await this.rateLimiter.acquire();

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: CLARITY_CHECK_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        response_format: { type: 'json_object' },
      });
    } catch (err) {
      logger.error(
        { err, model: this.config.model, description: input.description.slice(0, 100) },
        'Ошибка при вызове AI: проверка полноты записи дневника',
      );
      // При сбое провайдера не блокируем клиента: считаем запись достаточной,
      // чтобы не спамить уточнениями при временных проблемах с AI.
      return { needsClarification: false, missingFields: [], question: null };
    }

    const rawContent = response.choices[0]?.message?.content ?? '';
    const jsonContent = extractJson(rawContent);
    let parsed: Partial<ClarityCheckResult> | null = null;

    try {
      parsed = JSON.parse(jsonContent) as Partial<ClarityCheckResult>;
    } catch {
      logger.warn(
        { rawContent, model: this.config.model, description: input.description.slice(0, 100) },
        'AI вернул некорректный JSON при проверке полноты записи дневника',
      );
    }

    const validMissingFields: ClarityMissingField[] = ['product', 'quantity', 'time', 'calories'];
    const missingFields = (parsed?.missingFields ?? []).filter(
      (field): field is ClarityMissingField => validMissingFields.includes(field),
    );
    const needsClarification =
      typeof parsed?.needsClarification === 'boolean'
        ? parsed.needsClarification
        : missingFields.length > 0;
    const question = typeof parsed?.question === 'string' ? parsed.question.trim() || null : null;

    const result: ClarityCheckResult = {
      needsClarification,
      missingFields,
      question: needsClarification ? question : null,
    };

    logger.info(
      {
        model: this.config.model,
        description: input.description.slice(0, 100),
        needsClarification: result.needsClarification,
        missingFields: result.missingFields,
        usage: response.usage,
      },
      'AI: проверка полноты записи дневника завершена',
    );

    return result;
  }

  async extractTopProducts(input: TopProductsInput): Promise<TopProductsResult> {
    const limit = input.limit ?? DEFAULT_TOP_PRODUCTS_LIMIT;
    const entriesSummary = formatDiaryEntriesForTopProducts(input.entries);
    const userPrompt = buildTopProductsUserPrompt(entriesSummary, limit);
    const maxTokens = Math.min(this.config.maxTokens, 512);

    logger.debug(
      { model: this.config.model, entries: input.entries.length, limit },
      'Запрос к AI: топ продуктов итогового отчёта',
    );

    await this.rateLimiter.acquire();

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: TOP_PRODUCTS_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: this.config.temperature,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    } catch (firstErr) {
      logger.warn(
        { err: firstErr, model: this.config.model },
        'Топ продуктов: запрос с thinking=disabled не прошёл, повторяю без него',
      );
      try {
        response = await this.client.chat.completions.create({
          model: this.config.model,
          messages: [
            { role: 'system', content: TOP_PRODUCTS_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature: this.config.temperature,
          response_format: { type: 'json_object' },
        });
      } catch (err) {
        logger.error(
          { err, model: this.config.model },
          'Ошибка при вызове AI: топ продуктов — используем эвристический fallback',
        );
        return this.topProductsFallback(input, limit, 'provider_error');
      }
    }

    const rawContent = response.choices[0]?.message?.content ?? '';
    let parsed: { topProducts?: unknown } | null = null;
    try {
      parsed = JSON.parse(extractJson(rawContent)) as { topProducts?: unknown };
    } catch {
      logger.warn(
        {
          rawContentPreview: rawContent.slice(0, 300),
          model: this.config.model,
        },
        'AI вернул некорректный JSON при сборе топа продуктов',
      );
    }

    const candidates = Array.isArray(parsed?.topProducts)
      ? parsed.topProducts.map((item) => String(item))
      : [];
    const topProducts = finalizeTopProducts(candidates, input.entries, limit);
    const usedFallback = candidates.length === 0;

    logger.info(
      {
        model: this.config.model,
        entries: input.entries.length,
        topProducts,
        usedFallback,
        usage: response.usage,
      },
      'AI: топ продуктов итогового отчёта собран',
    );

    return {
      topProducts,
      metadata: {
        engine: usedFallback ? 'openai-compatible-fallback' : 'openai-compatible',
        model: this.config.model,
        baseURL: this.config.baseURL,
        usage: response.usage,
        finishReason: response.choices[0]?.finish_reason,
        reason: usedFallback ? 'invalid_or_empty' : undefined,
      },
    };
  }

  private topProductsFallback(
    input: TopProductsInput,
    limit: number,
    reason: string,
  ): TopProductsResult {
    return {
      topProducts: extractTopProductsHeuristic(input.entries, limit),
      metadata: {
        engine: 'openai-compatible-fallback',
        model: this.config.model,
        baseURL: this.config.baseURL,
        reason,
      },
    };
  }

  private eveningSummaryFallback(
    input: EveningSummaryInput,
    reason: string,
    extras: { usage?: unknown; finishReason?: string | null; err?: unknown } = {},
  ): EveningSummaryResult {
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
        usage: extras.usage,
        finishReason: extras.finishReason,
        reason,
        providerError: extras.err,
      },
    };
  }

  private buildPreviousHistorySummary(input: DiaryAnalysisInput): string | undefined {
    if (!input.previousHistory || input.previousHistory.length === 0) {
      return undefined;
    }
    return `Записей за предыдущий курс: ${input.previousHistory.length}. Последняя запись: ${input.previousHistory[0]?.description ?? '(без описания)'}.`;
  }
}

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return text;
  }
  return text.slice(start, end + 1);
}
