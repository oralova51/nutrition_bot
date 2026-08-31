// Топ продуктов итогового отчёта: вода не входит, напитки и еда остаются.
// Проверяем эвристику, sanitize ответа модели и mock-движок — без сети.

import { describe, expect, it } from 'vitest';
import { makeDiaryEntry } from '@nutrition-bot/shared/testing';
import { MockAIEngine } from './mock-engine.js';
import {
  extractTopProductsHeuristic,
  finalizeTopProducts,
  sanitizeTopProducts,
} from './top-products.js';

function entries(...descriptions: string[]) {
  return descriptions.map((description, index) =>
    makeDiaryEntry({ id: `diary-${index + 1}`, description }),
  );
}

describe('extractTopProductsHeuristic — вода и единицы', () => {
  it('не включает «грамм» из записи «я съел 100 г мяса»', () => {
    const top = extractTopProductsHeuristic(
      entries('Я съел 100 г мяса', 'Съела 100 грамм мяса', '200гр курицы'),
      5,
    );

    expect(top).not.toContain('грамм');
    expect(top).not.toContain('грама');
    expect(top).not.toContain('гр');
    expect(top).not.toContain('г');
    expect(top).not.toContain('100');
    expect(top).not.toContain('200');
    expect(top).toEqual(expect.arrayContaining(['мяса']));
  });

  it('не ставит воду в топ из «я выпила стакан воды»', () => {
    const top = extractTopProductsHeuristic(
      entries('Я выпила стакан воды', 'Выпил воды', 'водичка', 'минералка', 'Съела овсянку'),
      5,
    );

    expect(top).not.toContain('вода');
    expect(top).not.toContain('воды');
    expect(top).not.toContain('водичка');
    expect(top).not.toContain('минералка');
    expect(top).not.toContain('стакан');
    expect(top).toContain('овсянку');
  });

  it('оставляет напитки: чай, кофе, сок, кефир', () => {
    const top = extractTopProductsHeuristic(
      entries('Я выпила стакан воды', 'Выпила чай', 'Выпила чай', 'Кофе', 'Стакан сока', 'Кефир'),
      5,
    );

    expect(top).toEqual(expect.arrayContaining(['чай', 'кофе', 'сока', 'кефир']));
    expect(top).not.toContain('вода');
    expect(top).not.toContain('воды');
    expect(top).not.toContain('стакан');
  });

  it('если в дневнике только вода — топ пустой, а не «вода»', () => {
    expect(extractTopProductsHeuristic(entries('Я выпила стакан воды', 'Ещё воды'), 5)).toEqual([]);
  });
});

describe('sanitizeTopProducts — страховка от ответа модели', () => {
  it('вычищает воду и единицы, оставляет чай', () => {
    expect(sanitizeTopProducts(['грамм', 'вода', 'чай', 'стакан воды', 'кофе'], 5)).toEqual([
      'чай',
      'кофе',
    ]);
  });

  it('не принимает водку за воду', () => {
    expect(sanitizeTopProducts(['водка', 'вода', 'вино'], 5)).toEqual(['водка', 'вино']);
  });
});

describe('finalizeTopProducts', () => {
  it('если модель вернула только воду — добирает еду из дневника', () => {
    const result = finalizeTopProducts(
      ['вода', 'грамм'],
      entries('Я выпила стакан воды', 'Съела 100 г мяса', 'Выпила чай'),
      5,
    );

    expect(result).not.toContain('вода');
    expect(result).not.toContain('грамм');
    expect(result).toEqual(expect.arrayContaining(['мяса', 'чай']));
  });
});

describe('MockAIEngine.extractTopProducts', () => {
  it('не включает воду и оставляет напитки', async () => {
    const engine = new MockAIEngine();
    const result = await engine.extractTopProducts({
      entries: entries('Я выпила стакан воды', 'Выпила чай', 'Кофе', 'Я съел 100 грамм мяса'),
      limit: 5,
    });

    expect(result.topProducts).not.toContain('вода');
    expect(result.topProducts).not.toContain('воды');
    expect(result.topProducts).not.toContain('грамм');
    expect(result.topProducts).toEqual(expect.arrayContaining(['чай', 'кофе', 'мяса']));
    expect(result.metadata).toMatchObject({ engine: 'mock' });
  });
});
