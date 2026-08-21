// Поддельный pino-логгер: job'ы и сервисы принимают Logger параметром,
// поэтому в тестах его удобнее подменить целиком, а не мокать модуль логирования.

import { vi } from 'vitest';
import type { Logger } from 'pino';

export type TestLogger = Logger & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

export function makeTestLogger(): TestLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  } as unknown as TestLogger;
}
