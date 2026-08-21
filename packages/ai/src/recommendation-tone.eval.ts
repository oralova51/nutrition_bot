// Eval тона рекомендаций (этап 14, ФТ-7).
// MockAIEngine — детерминированный baseline без сети.
// OpenAICompatibleAIEngine — контракт: в промпт уходят правила и история за 7 дней.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDiaryEntry } from '@nutrition-bot/shared/testing';
import type { AIConfig } from './config.js';
import { MockAIEngine } from './mock-engine.js';
import { OpenAICompatibleAIEngine } from './openai-compatible-engine.js';
import {
  ANALYSIS_SYSTEM_PROMPT,
  RECOMMENDATION_SYSTEM_PROMPT,
  EVENING_SUMMARY_SYSTEM_PROMPT,
} from './prompts.js';
import type { ClientContext, DiaryAnalysisInput } from './types.js';

const NOW = new Date('2026-01-15T09:00:00.000Z');
const clientContext: ClientContext = { firstName: 'Оля', timezone: 'Europe/Kaliningrad' };

const FORBIDDEN_SNIPPETS = [
  'я вижу, что',
  'я заметил',
  'я заметила',
  'протеиновый коктейль',
  'сбиться с курса',
];

function hasForbiddenTone(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_SNIPPETS.some((snippet) => lower.includes(snippet));
}

function beer(id: string, mealAt: Date) {
  return makeDiaryEntry({
    id,
    description: 'Выпила бокал светлого чешского пива',
    mealAt,
  });
}

function analysisInput(overrides: Partial<DiaryAnalysisInput> = {}): DiaryAnalysisInput {
  const entry = overrides.entry ?? makeDiaryEntry();
  return {
    entry,
    history: overrides.history ?? [entry],
    clientContext,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Recommendation tone eval — промпты', () => {
  it('analysis prompt требует тишину на разовый treat и treat_frequency на паттерн', () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('treat_frequency');
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('{ "proposals": [] }');
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('Не предлагай пересказывать');
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('протеиновый коктейль');
  });

  it('recommendation prompt запрещает «я вижу, что сегодня» и замену пива на протеин', () => {
    expect(RECOMMENDATION_SYSTEM_PROMPT).toContain('я вижу / я заметил(а), что сегодня ты…');
    expect(RECOMMENDATION_SYSTEM_PROMPT).toContain('протеиновый коктейль');
    expect(RECOMMENDATION_SYSTEM_PROMPT).toContain('раз в неделю или на выходных');
  });

  it('evening prompt разрешает обзор дня, но не замену treat на протеин', () => {
    expect(EVENING_SUMMARY_SYSTEM_PROMPT).toContain('сегодня был бокал пива');
    expect(EVENING_SUMMARY_SYSTEM_PROMPT).toContain('воду / протеиновый коктейль');
  });
});

describe('Recommendation tone eval — MockAIEngine (baseline, no network)', () => {
  const engine = new MockAIEngine();

  it('пиво 1× → 0 proposals', async () => {
    const entry = beer('diary-1', NOW);
    const result = await engine.analyzeDiary(analysisInput({ entry, history: [entry] }));

    expect(result.proposals).toHaveLength(0);
  });

  it('пиво 2× за неделю → частота, без воды/протеина как замены', async () => {
    const earlier = beer('diary-1', new Date('2026-01-11T18:00:00.000Z'));
    const entry = beer('diary-2', NOW);
    const result = await engine.analyzeDiary(analysisInput({ entry, history: [entry, earlier] }));
    const text = await engine.generateRecommendationText(result.proposals[0]!, clientContext);

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.criterion).toBe('treat_frequency');
    expect(text.toLowerCase()).toMatch(/раз в неделю|выходн/);
    expect(hasForbiddenTone(text)).toBe(false);
  });

  it('курага → есть совет, без пересказа «я вижу»', async () => {
    const entry = makeDiaryEntry({
      id: 'diary-kuraga',
      description: 'Съела 5 ягод кураги',
      mealAt: NOW,
    });
    const result = await engine.analyzeDiary(analysisInput({ entry, history: [entry] }));
    const text = await engine.generateRecommendationText(result.proposals[0]!, clientContext);

    expect(result.proposals.length).toBeGreaterThan(0);
    expect(hasForbiddenTone(text)).toBe(false);
  });
});

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
  baseURL: 'https://ai.example.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  maxTokens: 1024,
  eveningSummaryMaxTokens: 2048,
  temperature: 0.7,
  requestTimeoutMs: 1000,
  rateLimitPerMinute: 1000,
};

describe('Recommendation tone eval — OpenAICompatibleAIEngine (contract)', () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({
      choices: [{ message: { content: '{"proposals":[]}' }, finish_reason: 'stop' }],
      usage: { total_tokens: 64 },
    });
  });

  it('кладёт в user-промпт пометку «только что введена» и записи за 7 дней', async () => {
    const entry = beer('diary-now', NOW);
    const kuraga = makeDiaryEntry({
      id: 'diary-kuraga',
      description: 'Съела 5 ягод кураги',
      mealAt: new Date('2026-01-15T08:00:00.000Z'),
    });
    const engine = new OpenAICompatibleAIEngine(contractConfig);

    await engine.analyzeDiary(analysisInput({ entry, history: [entry, kuraga] }));

    const request = create.mock.calls[0]?.[0] as {
      messages?: { role?: string; content?: string }[];
    };
    const system = request.messages?.[0]?.content ?? '';
    const user = request.messages?.[1]?.content ?? '';

    expect(system).toContain('treat_frequency');
    expect(user).toContain('только что введена');
    expect(user).toContain('Выпила бокал светлого чешского пива');
    expect(user).toContain('Съела 5 ягод кураги');
    expect(user).toContain('[текущая]');
  });
});
