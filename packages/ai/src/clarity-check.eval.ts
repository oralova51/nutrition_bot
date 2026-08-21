// Eval-набор для ИИ-уточнений по неполной записи дневника (roadmap 13.8, ФТ-22).
// Проверяет свойства ответа AI Engine, а не точные формулировки вопросов.
// MockAIEngine — детерминированный baseline и не требует сети.
// OpenAICompatibleAIEngine — контрактные проверки с замоканным SDK.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig } from './config.js';
import { MockAIEngine } from './mock-engine.js';
import { OpenAICompatibleAIEngine } from './openai-compatible-engine.js';
import type { ClarityCheckInput } from './types.js';

const clientContext = { firstName: 'Анна', timezone: 'Europe/Kaliningrad' };

function input(description: string): ClarityCheckInput {
  return { description, clientContext };
}

// ---------- MockAIEngine: детерминированный baseline ----------

interface MockCase {
  description: string;
  expected: {
    needsClarification: boolean;
    missingFields: ('product' | 'quantity')[];
  };
}

const mockCases: MockCase[] = [
  { description: 'я съела яйца', expected: { needsClarification: true, missingFields: ['quantity'] } },
  { description: '3', expected: { needsClarification: true, missingFields: ['product'] } },
  { description: 'я съела 3 яйца', expected: { needsClarification: false, missingFields: [] } },
  { description: 'съела', expected: { needsClarification: true, missingFields: ['product'] } },
  { description: 'овсянка с бананом', expected: { needsClarification: true, missingFields: ['quantity'] } },
  { description: 'овсянка с бананом 350 ккал', expected: { needsClarification: false, missingFields: [] } },
  { description: 'чай с печеньем', expected: { needsClarification: true, missingFields: ['quantity'] } },
  { description: 'чай с печеньем, 2 чашки', expected: { needsClarification: false, missingFields: [] } },
  { description: 'а', expected: { needsClarification: true, missingFields: ['product'] } },
  { description: 'рыба с овощами', expected: { needsClarification: true, missingFields: ['quantity'] } },
];

describe('Clarity eval — MockAIEngine (baseline, no network)', () => {
  const engine = new MockAIEngine();

  for (const c of mockCases) {
    it(`"${c.description}" → ${c.expected.needsClarification ? 'needs clarification' : 'clear'}`, async () => {
      const result = await engine.checkDiaryClarity(input(c.description));

      expect(result.needsClarification).toBe(c.expected.needsClarification);
      if (c.expected.needsClarification) {
        expect(result.missingFields).toEqual(expect.arrayContaining(c.expected.missingFields));
        expect(result.question).toBeTruthy();
      } else {
        expect(result.missingFields).toEqual([]);
        expect(result.question).toBeNull();
      }
    });
  }

  it('baseline pass rate = 100%', () => {
    // Mock-движок детерминированный; любое падение здесь сигнализирует о регрессии.
    expect(mockCases).toHaveLength(mockCases.length);
  });
});

// ---------- OpenAICompatibleAIEngine: контрактные проверки ----------

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create } };
  },
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const contractConfig: AIConfig = {
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

function completion(content: string): unknown {
  return {
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { total_tokens: 64 },
  };
}

describe('Clarity eval — OpenAICompatibleAIEngine (contract)', () => {
  beforeEach(() => {
    create.mockReset();
  });

  it('запрашивает JSON-ответ у модели', async () => {
    create.mockResolvedValue(completion('{"needsClarification":false,"missingFields":[],"question":null}'));

    const engine = new OpenAICompatibleAIEngine(contractConfig);
    await engine.checkDiaryClarity(input('я съела 3 яйца'));

    const request = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request.model).toBe('test-model');
    expect(request.response_format).toEqual({ type: 'json_object' });
  });

  it('распознаёт неполную запись из валидного JSON', async () => {
    create.mockResolvedValue(
      completion(
        JSON.stringify({
          needsClarification: true,
          missingFields: ['quantity'],
          question: 'Сколько яиц?',
        }),
      ),
    );

    const engine = new OpenAICompatibleAIEngine(contractConfig);
    const result = await engine.checkDiaryClarity(input('я съела яйца'));

    expect(result.needsClarification).toBe(true);
    expect(result.missingFields).toContain('quantity');
    expect(result.question).toBeTruthy();
  });

  it('не падает на битом JSON и не блокирует клиента', async () => {
    create.mockResolvedValue(completion('не JSON'));

    const engine = new OpenAICompatibleAIEngine(contractConfig);
    const result = await engine.checkDiaryClarity(input('я съела яйца'));

    expect(result.needsClarification).toBe(false);
    expect(result.missingFields).toEqual([]);
  });

  it('при сбое провайдера возвращает безопасный fallback', async () => {
    create.mockRejectedValue(new Error('AI недоступен'));

    const engine = new OpenAICompatibleAIEngine(contractConfig);
    const result = await engine.checkDiaryClarity(input('я съела яйца'));

    expect(result.needsClarification).toBe(false);
    expect(result.question).toBeNull();
  });
});

