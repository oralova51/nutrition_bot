// Юнит-тесты playground ИИ-уточнений: валидация тела и маппинг ответа бота.
// Движок подменяется — сеть и живая модель не нужны.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, AIEngine } from '@nutrition-bot/ai';

const { createAIEngine, resolveAIConfig } = vi.hoisted(() => ({
  createAIEngine: vi.fn(),
  resolveAIConfig: vi.fn(),
}));

vi.mock('@nutrition-bot/ai', () => ({
  createAIEngine,
  resolveAIConfig,
}));

import { runClarityCheckPlayground } from './ai-clarity.js';

const checkDiaryClarity = vi.fn();
const mockConfig = { provider: 'mock' } as AIConfig;

function fakeEngine(): AIEngine {
  return {
    analyzeDiary: vi.fn(),
    generateRecommendationText: vi.fn(),
    generateEveningSummary: vi.fn(),
    checkDiaryClarity,
  };
}

describe('runClarityCheckPlayground', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAIConfig.mockReturnValue(mockConfig);
    createAIEngine.mockReturnValue(fakeEngine());
  });

  it('просит уточнение и подставляет вопрос модели в botReply', async () => {
    checkDiaryClarity.mockResolvedValue({
      needsClarification: true,
      missingFields: ['quantity'],
      question: 'Сколько яиц вы съели?',
    });

    const result = await runClarityCheckPlayground({
      description: 'я съела яйца',
      firstName: 'Анна',
    });

    expect(checkDiaryClarity).toHaveBeenCalledWith({
      description: 'я съела яйца',
      hasPhoto: undefined,
      approxCalories: null,
      clientContext: { firstName: 'Анна', timezone: 'Europe/Kaliningrad' },
    });
    expect(result).toEqual({
      needsClarification: true,
      missingFields: ['quantity'],
      question: 'Сколько яиц вы съели?',
      botReply: 'Сколько яиц вы съели?',
      provider: 'mock',
    });
  });

  it('при пустом вопросе модели подставляет запасную фразу бота', async () => {
    checkDiaryClarity.mockResolvedValue({
      needsClarification: true,
      missingFields: ['product'],
      question: null,
    });

    const result = await runClarityCheckPlayground({ description: 'съела' });

    expect(result.botReply).toBe('Кажется, я не понял. Можете переформулировать?');
    expect(result.question).toBeNull();
  });

  it('когда записи достаточно — подтверждает без уточнения', async () => {
    checkDiaryClarity.mockResolvedValue({
      needsClarification: false,
      missingFields: [],
      question: 'не должен уйти клиенту',
    });

    const result = await runClarityCheckPlayground({ description: 'я съела 3 яйца' });

    expect(result).toMatchObject({
      needsClarification: false,
      missingFields: [],
      question: null,
      botReply: 'Спасибо, записал! 🍽️',
    });
  });

  it('при сбое движка не блокирует клиента уточнением', async () => {
    checkDiaryClarity.mockRejectedValue(new Error('AI недоступен'));

    const result = await runClarityCheckPlayground({ description: 'яйца' });

    expect(result).toEqual({
      needsClarification: false,
      missingFields: [],
      question: null,
      botReply: 'Спасибо, записал! 🍽️',
      provider: 'mock',
    });
  });

  it('передаёт hasPhoto и approxCalories в движок', async () => {
    checkDiaryClarity.mockResolvedValue({
      needsClarification: false,
      missingFields: [],
      question: null,
    });

    await runClarityCheckPlayground({
      description: 'салат',
      hasPhoto: true,
      approxCalories: 250,
    });

    expect(checkDiaryClarity).toHaveBeenCalledWith(
      expect.objectContaining({ hasPhoto: true, approxCalories: 250 }),
    );
  });

  it('отклоняет пустое описание', async () => {
    await expect(runClarityCheckPlayground({ description: '  ' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_BODY',
    });
    expect(checkDiaryClarity).not.toHaveBeenCalled();
  });

  it('отклоняет невалидную калорийность', async () => {
    await expect(
      runClarityCheckPlayground({ description: 'борщ', approxCalories: -10 }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_BODY' });
  });

  it('отклоняет hasPhoto не булева типа', async () => {
    await expect(
      runClarityCheckPlayground({ description: 'борщ', hasPhoto: 'yes' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_BODY' });
  });
});
