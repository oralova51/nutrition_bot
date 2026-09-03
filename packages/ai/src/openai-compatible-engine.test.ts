// Контрактные тесты адаптера OpenAI-compatible: проверяют не качество советов,
// а устойчивость кода к тому, что реально присылает модель — битый JSON,
// обрыв по max_tokens, пустая сводка, отказ провайдера.
// Реальная модель не вызывается: SDK замокан, ответы берутся из фикстур.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDiaryEntry } from '@nutrition-bot/shared/testing';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create } };
  },
}));
vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { AIConfig } from './config.js';
import { OpenAICompatibleAIEngine } from './openai-compatible-engine.js';
import type { ClientContext, DiaryAnalysisInput, RecommendationProposal } from './types.js';

const config: AIConfig = {
  provider: 'openai-compatible',
  apiKey: 'test-key',
  baseURL: 'https://ai.example.test/v1',
  model: 'test-model',
  maxTokens: 1024,
  eveningSummaryMaxTokens: 2048,
  temperature: 0.7,
  requestTimeoutMs: 1000,
  rateLimitPerMinute: 1000,
};

const clientContext: ClientContext = { firstName: 'Анна', timezone: 'Europe/Kaliningrad' };

function completion(content: string, finishReason = 'stop'): unknown {
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { total_tokens: 128 },
  };
}

function diaryInput(): DiaryAnalysisInput {
  const entry = makeDiaryEntry({ description: 'Овсянка с яблоком', approxCalories: 320 });
  return { entry, history: [entry], clientContext };
}

function engine(): OpenAICompatibleAIEngine {
  return new OpenAICompatibleAIEngine(config);
}

/** Пользовательская часть промпта из вызова SDK с указанным номером. */
function userPromptOf(callIndex: number): string {
  const request = create.mock.calls[callIndex]?.[0] as
    { messages?: { content?: string }[] } | undefined;
  return request?.messages?.[1]?.content ?? '';
}

beforeEach(() => {
  create.mockReset();
});

describe('analyzeDiary', () => {
  it('запрашивает у модели строгий JSON', async () => {
    create.mockResolvedValue(completion('{"proposals":[]}'));

    await engine().analyzeDiary(diaryInput());

    const request = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request.model).toBe('test-model');
    expect(request.response_format).toEqual({ type: 'json_object' });
    expect(request.max_tokens).toBe(1024);
  });

  it('сохраняет id предложения, если модель его прислала', async () => {
    create.mockResolvedValue(
      completion(
        JSON.stringify({
          proposals: [
            {
              id: 'proposal-from-model',
              criterion: 'water',
              type: 'habit',
              priority: 'medium',
              rationale: 'Воды в записи нет',
              draftText: 'Добавь стакан воды',
            },
          ],
        }),
      ),
    );

    const result = await engine().analyzeDiary(diaryInput());

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.id).toBe('proposal-from-model');
    expect(result.metadata).toMatchObject({ engine: 'openai-compatible', model: 'test-model' });
  });

  it('подставляет id, если модель его не вернула', async () => {
    create.mockResolvedValue(
      completion(
        JSON.stringify({
          proposals: [{ criterion: 'protein_deficit', type: 'product', priority: 'high' }],
        }),
      ),
    );

    const result = await engine().analyzeDiary(diaryInput());

    expect(result.proposals[0]?.id).toEqual(expect.any(String));
    expect(result.proposals[0]?.id).not.toBe('');
  });

  it('возвращает пустой список вместо падения, если модель прислала не JSON', async () => {
    create.mockResolvedValue(completion('Конечно! Вот мой анализ: пейте больше воды.'));

    const result = await engine().analyzeDiary(diaryInput());

    expect(result.proposals).toEqual([]);
  });

  it('возвращает пустой список, если в JSON нет поля proposals', async () => {
    create.mockResolvedValue(completion('{"analysis":"всё хорошо"}'));

    const result = await engine().analyzeDiary(diaryInput());

    expect(result.proposals).toEqual([]);
  });

  it('передаёт модели контекст предыдущего курса при продлении', async () => {
    create.mockResolvedValue(completion('{"proposals":[]}'));
    const entry = makeDiaryEntry();

    await engine().analyzeDiary({
      entry,
      history: [entry],
      previousHistory: [
        makeDiaryEntry({ id: 'old-1', description: 'Пицца и кола' }),
        makeDiaryEntry({ id: 'old-2', description: 'Салат' }),
      ],
      clientContext,
    });

    expect(userPromptOf(0)).toContain('Контекст за предыдущий курс');
    expect(userPromptOf(0)).toContain('Записей за предыдущий курс: 2');
    expect(userPromptOf(0)).toContain('Пицца и кола');
  });

  it('не упоминает предыдущий курс, если его не было', async () => {
    create.mockResolvedValue(completion('{"proposals":[]}'));

    await engine().analyzeDiary(diaryInput());

    expect(userPromptOf(0)).not.toContain('Контекст за предыдущий курс');
    expect(userPromptOf(0)).toContain('Анкета не заполнена.');
  });

  it('сообщает модели о приложенном фото и калорийности', async () => {
    create.mockResolvedValue(completion('{"proposals":[]}'));
    const entry = makeDiaryEntry({ hasPhoto: true, approxCalories: 450 });

    await engine().analyzeDiary({ entry, history: [entry], clientContext });

    expect(userPromptOf(0)).toContain('К записи приложено фото.');
    expect(userPromptOf(0)).toContain('Приблизительная калорийность: 450 ккал.');
  });

  it('передаёт описания за 7 дней и пометку, что запись только что введена', async () => {
    create.mockResolvedValue(completion('{"proposals":[]}'));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T09:00:00.000Z'));
    const entry = makeDiaryEntry({
      id: 'diary-now',
      description: 'Выпила бокал пива',
      mealAt: new Date('2026-01-15T09:00:00.000Z'),
    });
    const earlier = makeDiaryEntry({
      id: 'diary-kuraga',
      description: 'Съела 5 ягод кураги',
      mealAt: new Date('2026-01-14T12:00:00.000Z'),
    });

    try {
      await engine().analyzeDiary({ entry, history: [entry, earlier], clientContext });
    } finally {
      vi.useRealTimers();
    }

    expect(userPromptOf(0)).toContain('только что введена');
    expect(userPromptOf(0)).toContain('Выпила бокал пива [текущая]');
    expect(userPromptOf(0)).toContain('Съела 5 ягод кураги');
  });

  it('пробрасывает отказ провайдера: вызывающий решает, что делать', async () => {
    create.mockRejectedValue(new Error('429 Too Many Requests'));

    await expect(engine().analyzeDiary(diaryInput())).rejects.toThrow('429 Too Many Requests');
  });
});

describe('generateRecommendationText', () => {
  const proposal: RecommendationProposal = {
    id: 'proposal-1',
    criterion: 'water',
    type: 'habit',
    priority: 'medium',
    rationale: 'Воды в записи нет',
    draftText: 'Черновик: добавь стакан воды.',
  };

  it('возвращает текст модели без лишних пробелов', async () => {
    create.mockResolvedValue(completion('  Попробуй добавить стакан воды к обеду.  '));

    const text = await engine().generateRecommendationText(proposal, clientContext);

    expect(text).toBe('Попробуй добавить стакан воды к обеду.');
  });

  it('откатывается на черновик при отказе провайдера: клиент не остаётся без ответа', async () => {
    create.mockRejectedValue(new Error('503 Service Unavailable'));

    const text = await engine().generateRecommendationText(proposal, clientContext);

    expect(text).toBe('Черновик: добавь стакан воды.');
  });

  it('для treat_frequency просит модель писать про частоту, не про замену', async () => {
    create.mockResolvedValue(completion('Пиво ок на выходных.'));
    const treatProposal: RecommendationProposal = {
      ...proposal,
      criterion: 'treat_frequency',
      draftText: 'Ок раз в неделю.',
    };

    await engine().generateRecommendationText(treatProposal, clientContext);

    expect(userPromptOf(0)).toContain('Пиши про частоту, не про замену продукта.');
  });

  it('откатывается на черновик, если модель вернула пустой ответ', async () => {
    create.mockResolvedValue(completion(''));

    const text = await engine().generateRecommendationText(proposal, clientContext);

    expect(text).toBe('Черновик: добавь стакан воды.');
  });
});

describe('generateEveningSummary', () => {
  const summaryInput = {
    dayEntries: [
      makeDiaryEntry({ id: 'diary-1', description: 'Овсянка с яблоком', approxCalories: 320 }),
      makeDiaryEntry({ id: 'diary-2', description: 'Куриная грудка и салат' }),
    ],
    clientContext,
    localDate: '2026-01-15',
  };

  const validSummary = JSON.stringify({
    enough: ['Белок был'],
    missing: ['Мало воды'],
    toAdd: ['Добавь стакан воды к ужину'],
    improvements: ['Распредели приёмы пищи равномернее'],
    summaryText:
      '<b>Вечерняя сводка за 2026-01-15</b>\n\nПривет, Анна! Сегодня получилось неплохо.',
  });

  it('первым запросом отключает reasoning, иначе сводку обрежет по max_tokens', async () => {
    create.mockResolvedValue(completion(validSummary));

    await engine().generateEveningSummary(summaryInput);

    const request = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request.thinking).toEqual({ type: 'disabled' });
    expect(request.max_tokens).toBe(2048);
  });

  it('раскладывает корректный ответ модели по блокам', async () => {
    create.mockResolvedValue(completion(validSummary));

    const result = await engine().generateEveningSummary(summaryInput);

    expect(result.enough).toEqual(['Белок был']);
    expect(result.missing).toEqual(['Мало воды']);
    expect(result.summaryText).toContain('Привет, Анна!');
    expect(result.metadata).toMatchObject({ engine: 'openai-compatible' });
  });

  it('повторяет запрос без thinking, если провайдер его не принял', async () => {
    create
      .mockRejectedValueOnce(new Error('unknown parameter: thinking'))
      .mockResolvedValueOnce(completion(validSummary));

    const result = await engine().generateEveningSummary(summaryInput);

    expect(create).toHaveBeenCalledTimes(2);
    expect((create.mock.calls[1]?.[0] as Record<string, unknown>).thinking).toBeUndefined();
    expect(result.summaryText).toContain('Привет, Анна!');
  });

  it('падает на эвристику, если не прошёл и повторный запрос', async () => {
    create.mockRejectedValue(new Error('503 Service Unavailable'));

    const result = await engine().generateEveningSummary(summaryInput);

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.metadata).toMatchObject({
      engine: 'openai-compatible-fallback',
      reason: 'provider_error',
    });
    expect(result.metadata.providerError).toBeInstanceOf(Error);
    expect(result.summaryText).toContain('Вечерняя сводка за 2026-01-15');
    expect(result.summaryText).toContain('Овсянка с яблоком');
  });

  it('достаёт JSON, даже если модель обернула его в markdown', async () => {
    create.mockResolvedValue(completion(`\`\`\`json\n${validSummary}\n\`\`\``));

    const result = await engine().generateEveningSummary(summaryInput);

    expect(result.enough).toEqual(['Белок был']);
    expect(result.metadata).toMatchObject({ engine: 'openai-compatible' });
  });

  it('падает на эвристику, если модель прислала не JSON', async () => {
    create.mockResolvedValue(completion('Вот сводка за день: всё отлично!'));

    const result = await engine().generateEveningSummary(summaryInput);

    expect(result.metadata).toMatchObject({
      engine: 'openai-compatible-fallback',
      reason: 'invalid_json',
    });
    expect(result.summaryText).toContain('Вечерняя сводка за 2026-01-15');
    expect(result.summaryText).toContain('Овсянка с яблоком');
  });

  it('сохраняет причину обрыва по max_tokens в metadata', async () => {
    create.mockResolvedValue(completion(validSummary, 'length'));

    const result = await engine().generateEveningSummary(summaryInput);

    expect(result.metadata).toMatchObject({ finishReason: 'length' });
  });

  it('собирает текст из блоков, если модель прислала слишком короткий summaryText', async () => {
    create.mockResolvedValue(
      completion(
        JSON.stringify({
          enough: ['Белок был'],
          missing: ['Мало воды'],
          toAdd: ['Добавь стакан воды'],
          improvements: [],
          summaryText: 'Ок',
        }),
      ),
    );

    const result = await engine().generateEveningSummary(summaryInput);

    expect(result.summaryText).toContain('<b>Вечерняя сводка за 2026-01-15</b>');
    expect(result.summaryText).toContain('Мало воды');
    expect(result.metadata).toMatchObject({ engine: 'openai-compatible' });
  });

  it('падает на эвристику, если модель прислала валидный, но пустой JSON', async () => {
    create.mockResolvedValue(completion('{}'));

    const result = await engine().generateEveningSummary(summaryInput);

    expect(result.metadata).toMatchObject({
      engine: 'openai-compatible-fallback',
      reason: 'empty_summary',
    });
    expect(result.summaryText).toContain('Куриная грудка и салат');
  });
});

describe('extractTopProducts', () => {
  const diaryEntries = [
    makeDiaryEntry({ id: 'diary-1', description: 'Я съел 100 грамм мяса' }),
    makeDiaryEntry({ id: 'diary-2', description: 'Я выпила стакан воды' }),
    makeDiaryEntry({ id: 'diary-3', description: 'Выпила чай' }),
    makeDiaryEntry({ id: 'diary-4', description: 'Кофе' }),
  ];

  it('просит JSON и отключает reasoning', async () => {
    create.mockResolvedValue(completion('{"topProducts":["мясо","чай"]}'));

    await engine().extractTopProducts({ entries: diaryEntries, limit: 5 });

    const request = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request.response_format).toEqual({ type: 'json_object' });
    expect(request.thinking).toEqual({ type: 'disabled' });
    expect(userPromptOf(0)).toContain('Простую воду не включай');
    expect(userPromptOf(0)).toContain('Я выпила стакан воды');
  });

  it('вычищает воду и граммы, даже если модель их вернула, напитки оставляет', async () => {
    create.mockResolvedValue(
      completion(JSON.stringify({ topProducts: ['грамм', 'вода', 'чай', 'мясо', 'кофе'] })),
    );

    const result = await engine().extractTopProducts({ entries: diaryEntries, limit: 5 });

    expect(result.topProducts).not.toContain('грамм');
    expect(result.topProducts).not.toContain('вода');
    expect(result.topProducts).toEqual(expect.arrayContaining(['чай', 'мясо', 'кофе']));
    expect(result.metadata).toMatchObject({ engine: 'openai-compatible' });
  });

  it('при сбое провайдера не бросает ошибку и падает на эвристику без воды', async () => {
    create.mockRejectedValue(new Error('503 Service Unavailable'));

    const result = await engine().extractTopProducts({ entries: diaryEntries, limit: 5 });

    expect(result.metadata).toMatchObject({
      engine: 'openai-compatible-fallback',
      reason: 'provider_error',
    });
    expect(result.topProducts).not.toContain('вода');
    expect(result.topProducts).not.toContain('грамм');
    expect(result.topProducts).toEqual(expect.arrayContaining(['чай', 'кофе', 'мяса']));
  });

  it('при битом JSON добирает топ эвристикой', async () => {
    create.mockResolvedValue(completion('вот топ: вода, грамм, чай'));

    const result = await engine().extractTopProducts({ entries: diaryEntries, limit: 5 });

    expect(result.metadata).toMatchObject({ engine: 'openai-compatible-fallback' });
    expect(result.topProducts).not.toContain('вода');
    expect(result.topProducts).toContain('чай');
  });
});
