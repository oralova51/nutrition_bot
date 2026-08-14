import { describe, expect, it } from 'vitest';
import {
  formatZonedDate,
  formatZonedTime,
  getZonedDayRange,
  isLocalTimeOnOrAfter,
} from './zoned.js';

const TZ = 'Europe/Kaliningrad';

describe('zoned time helpers', () => {
  it('formats Kaliningrad wall-clock from a UTC instant', () => {
    const utc = new Date('2026-08-14T19:00:00.000Z');
    expect(formatZonedDate(utc, TZ)).toBe('2026-08-14');
    expect(formatZonedTime(utc, TZ)).toBe('21:00');
  });

  it('builds a day range in UTC for a Kaliningrad calendar day', () => {
    const utcNoon = new Date('2026-08-14T12:00:00.000Z');
    const range = getZonedDayRange(utcNoon, TZ);
    expect(range.start.toISOString()).toBe('2026-08-13T22:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-08-14T21:59:59.999Z');
  });

  it('treats 21:00 Kaliningrad as the evening-summary slot', () => {
    expect(isLocalTimeOnOrAfter(new Date('2026-08-14T18:59:00.000Z'), TZ, '21:00')).toBe(false);
    expect(isLocalTimeOnOrAfter(new Date('2026-08-14T19:00:00.000Z'), TZ, '21:00')).toBe(true);
    expect(isLocalTimeOnOrAfter(new Date('2026-08-14T19:30:00.000Z'), TZ, '21:00')).toBe(true);
  });
});
