import { describe, expect, it } from 'vitest';
import { countTreatClass, detectTreatClass } from './treat-pattern.js';

describe('detectTreatClass', () => {
  it('распознаёт алкоголь, сладкое и джанк', () => {
    expect(detectTreatClass('Выпила бокал светлого чешского пива')).toBe('alcohol');
    expect(detectTreatClass('Бокал белого вина')).toBe('alcohol');
    expect(detectTreatClass('Кусок торта')).toBe('sweets');
    expect(detectTreatClass('Пачка чипсов и печенье')).toBe('sweets');
    expect(detectTreatClass('Пицца на ужин')).toBe('junk');
    expect(detectTreatClass('картошка фри с соусом')).toBe('junk');
  });

  it('не путает обычную еду с удовольствием', () => {
    expect(detectTreatClass('Съела 5 ягод кураги')).toBeNull();
    expect(detectTreatClass('Виноград и свинина')).toBeNull();
    expect(detectTreatClass('Винегрет с горошком')).toBeNull();
    expect(detectTreatClass('Овсянка с яблоком')).toBeNull();
    expect(detectTreatClass(null)).toBeNull();
    expect(detectTreatClass('   ')).toBeNull();
  });
});

describe('countTreatClass', () => {
  it('считает только записи того же класса', () => {
    const entries = [
      { description: 'Бокал пива' },
      { description: 'Бокал вина' },
      { description: 'Торт' },
      { description: 'Курага' },
    ];

    expect(countTreatClass(entries, 'alcohol')).toBe(2);
    expect(countTreatClass(entries, 'sweets')).toBe(1);
    expect(countTreatClass(entries, 'junk')).toBe(0);
  });
});
