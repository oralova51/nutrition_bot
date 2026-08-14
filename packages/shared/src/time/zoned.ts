// Хелперы локального времени клиента (MVP: Europe/Kaliningrad).
// Нужны scheduler-job'ам и дневнику, чтобы не сравнивать HH:mm с UTC-часами сервера.

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export function formatZonedDate(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd');
}

export function formatZonedTime(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'HH:mm');
}

export function getZonedDayRange(date: Date, timezone: string): { start: Date; end: Date } {
  const dateString = formatZonedDate(date, timezone);
  const startLocal = new Date(`${dateString}T00:00:00`);
  const endLocal = new Date(`${dateString}T23:59:59.999`);
  return {
    start: fromZonedTime(startLocal, timezone),
    end: fromZonedTime(endLocal, timezone),
  };
}

/** Локальное HH:mm клиента уже наступило (включительно), до полуночи. */
export function isLocalTimeOnOrAfter(date: Date, timezone: string, hhmm: string): boolean {
  return zonedMinutesFromMidnight(date, timezone) >= parseHHmmToMinutes(hhmm);
}

function zonedMinutesFromMidnight(date: Date, timezone: string): number {
  return parseHHmmToMinutes(formatZonedTime(date, timezone));
}

function parseHHmmToMinutes(hhmm: string): number {
  const [hoursRaw, minutesRaw] = hhmm.split(':');
  const hours = Number.parseInt(hoursRaw ?? '0', 10);
  const minutes = Number.parseInt(minutesRaw ?? '0', 10);
  return hours * 60 + minutes;
}
