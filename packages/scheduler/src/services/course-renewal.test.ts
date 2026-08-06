// Unit-тесты для чистых функций предложения продления курса (roadmap 8.1–8.2).

import { describe, expect, it } from 'vitest';
import { calculateFinalPriceKopecks } from '@nutrition-bot/shared';
import { buildRenewalKeyboard, buildRenewalMessage } from './course-renewal.js';

describe('course-renewal pure functions', () => {
  describe('calculateFinalPriceKopecks', () => {
    it('applies 15% discount to kopecks', () => {
      expect(calculateFinalPriceKopecks(1_000_000, 15)).toBe(850_000);
    });

    it('rounds to nearest integer kopeck', () => {
      expect(calculateFinalPriceKopecks(9999, 15)).toBe(8499);
    });
  });

  describe('buildRenewalMessage', () => {
    it('formats prices in rubles and uses discountPercent', () => {
      const message = buildRenewalMessage(1_000_000, 15, 850_000);
      expect(message).toContain('10 000 ₽');
      expect(message).toContain('−15%');
      expect(message).toContain('8 500 ₽');
      expect(message).toContain('специальная скидка 15%');
    });

    it('uses a custom discount percent', () => {
      const message = buildRenewalMessage(1_000_000, 20, 800_000);
      expect(message).toContain('специальная скидка 20%');
      expect(message).toContain('−20%');
      expect(message).toContain('8 000 ₽');
    });
  });

  describe('buildRenewalKeyboard', () => {
    it('contains accept callback with offer id', () => {
      const keyboard = buildRenewalKeyboard('offer-123');
      const button = keyboard.inline_keyboard[0]?.[0];
      expect(button?.text).toBe('Продлить курс');
      expect(button?.callback_data).toBe('renewal:accept:offer-123');
    });
  });
});
