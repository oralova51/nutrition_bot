import { describe, expect, it } from 'vitest';
import { classifyProviderError } from './provider-error.js';

describe('classifyProviderError', () => {
  it('распознаёт закончившуюся квоту OpenAI по code', () => {
    const err = Object.assign(new Error('You exceeded your current quota'), {
      status: 429,
      code: 'insufficient_quota',
    });

    const classified = classifyProviderError(err);
    expect(classified.class).toBe('billing');
    expect(classified.reason).toContain('закончились деньги');
  });

  it('распознаёт биллинг по русскому тексту', () => {
    expect(classifyProviderError(new Error('Недостаточно средств на счёте'))).toMatchObject({
      class: 'billing',
    });
  });

  it('отличает rate limit 429 от квоты', () => {
    const err = Object.assign(new Error('Rate limit reached'), {
      status: 429,
      code: 'rate_limit_exceeded',
    });

    const classified = classifyProviderError(err);
    expect(classified.class).toBe('rate_limit');
    expect(classified.reason).toContain('частоту запросов');
  });

  it('распознаёт неверный ключ', () => {
    const err = Object.assign(new Error('Incorrect API key provided'), {
      status: 401,
      code: 'invalid_api_key',
    });

    expect(classifyProviderError(err)).toMatchObject({ class: 'auth' });
  });

  it('считает 5xx недоступностью провайдера', () => {
    const err = Object.assign(new Error('503 Service Unavailable'), { status: 503 });

    expect(classifyProviderError(err)).toMatchObject({ class: 'provider' });
  });

  it('читает вложенный error.code как у OpenAI SDK', () => {
    expect(
      classifyProviderError({
        status: 429,
        error: { code: 'insufficient_quota', message: 'quota' },
      }),
    ).toMatchObject({ class: 'billing' });
  });

  it('неизвестное оставляет как unknown, не выдумывает биллинг', () => {
    expect(classifyProviderError(new Error('relation does not exist'))).toMatchObject({
      class: 'unknown',
    });
  });
});
