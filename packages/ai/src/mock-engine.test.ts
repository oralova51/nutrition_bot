import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDiaryEntry } from '@nutrition-bot/shared/testing';
import { MockAIEngine } from './mock-engine.js';
import type { ClientContext, DiaryAnalysisInput } from './types.js';

const TIMEZONE = 'Europe/Kaliningrad';
const clientContext: ClientContext = { firstName: 'Оля', timezone: TIMEZONE };
const NOW = new Date('2026-01-15T09:00:00.000Z');

function beer(id: string, mealAt: Date): ReturnType<typeof makeDiaryEntry> {
  return makeDiaryEntry({
    id,
    description: 'Выпила бокал светлого чешского пива',
    mealAt,
  });
}

function input(overrides: Partial<DiaryAnalysisInput> = {}): DiaryAnalysisInput {
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

describe('MockAIEngine.analyzeDiary — тон ФТ-7', () => {
  const engine = new MockAIEngine();

  it('молчит на разовый бокал пива', async () => {
    const entry = beer('diary-beer', NOW);
    const result = await engine.analyzeDiary(input({ entry, history: [entry] }));

    expect(result.proposals).toEqual([]);
    expect(result.metadata.skipReason).toBe('isolated_treat');
  });

  it('на повтор пива за неделю даёт частотную рамку, не замену на протеин', async () => {
    const earlier = beer('diary-beer-1', new Date('2026-01-12T18:00:00.000Z'));
    const entry = beer('diary-beer-2', NOW);
    const result = await engine.analyzeDiary(input({ entry, history: [entry, earlier] }));

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.criterion).toBe('treat_frequency');
    const text = result.proposals[0]?.draftText ?? '';
    expect(text.toLowerCase()).toContain('раз в неделю');
    expect(text.toLowerCase()).not.toContain('протеиновый коктейль');
    expect(text.toLowerCase()).not.toContain('я вижу');
  });

  it('добавляет текущую запись в подсчёт, даже если её нет в history', async () => {
    const earlier = beer('diary-beer-1', new Date('2026-01-12T18:00:00.000Z'));
    const entry = beer('diary-beer-2', NOW);
    const result = await engine.analyzeDiary(input({ entry, history: [earlier] }));

    expect(result.proposals[0]?.criterion).toBe('treat_frequency');
  });

  it('на курагу даёт совет про разрыв, а не тишину', async () => {
    const entry = makeDiaryEntry({
      id: 'diary-kuraga',
      description: 'Съела 5 ягод кураги',
      mealAt: NOW,
    });
    const result = await engine.analyzeDiary(input({ entry, history: [entry] }));

    expect(result.proposals.length).toBeGreaterThan(0);
    expect(result.proposals[0]?.criterion).not.toBe('treat_frequency');
    expect(result.metadata.skipReason).toBeUndefined();
  });

  it('на обычный обед без белка по-прежнему предлагает белок', async () => {
    const entry = makeDiaryEntry({
      id: 'diary-lunch',
      description: 'Гречка с овощами',
      mealAt: NOW,
    });
    const result = await engine.analyzeDiary(input({ entry, history: [entry] }));

    expect(result.proposals[0]?.criterion).toBe('protein_deficit');
  });
});
