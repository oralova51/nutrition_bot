import { describe, expect, it } from 'vitest';
import { parseClientName, parseDurationDays } from './admin-ops.js';

describe('parseClientName', () => {
  it('parses first and last name', () => {
    expect(parseClientName('Анна Иванова')).toEqual({
      firstName: 'Анна',
      lastName: 'Иванова',
    });
  });

  it('uses dash when only first name given', () => {
    expect(parseClientName('Анна')).toEqual({ firstName: 'Анна', lastName: '-' });
  });

  it('keeps rest of string as last name', () => {
    expect(parseClientName('Анна Мария Иванова')).toEqual({
      firstName: 'Анна',
      lastName: 'Мария Иванова',
    });
  });

  it('returns null for empty input', () => {
    expect(parseClientName('   ')).toBeNull();
  });
});

describe('parseDurationDays', () => {
  it('accepts 1..365', () => {
    expect(parseDurationDays('30')).toBe(30);
    expect(parseDurationDays('1')).toBe(1);
    expect(parseDurationDays('365')).toBe(365);
  });

  it('rejects invalid values', () => {
    expect(parseDurationDays('0')).toBeNull();
    expect(parseDurationDays('366')).toBeNull();
    expect(parseDurationDays('30.5')).toBeNull();
    expect(parseDurationDays('abc')).toBeNull();
  });
});
