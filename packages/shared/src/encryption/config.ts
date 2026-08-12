// Конфигурация шифрования полей БД (AES-256-GCM).
// Ключ задаётся через ENCRYPTION_KEY; в тестовом окружении используется
// фиксированный ключ, чтобы тесты не зависели от .env. В production ключ
// обязателен и должен быть случайным 32+ байт.

import { createHash, randomBytes } from 'node:crypto';

const KEY_LENGTH = 32;

export function deriveEncryptionKey(raw: string): Buffer {
  return createHash('sha256').update(raw).digest();
}

export function resolveEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    return deriveEncryptionKey(raw);
  }

  if (process.env.NODE_ENV === 'test') {
    // Фиксированный ключ допустим только в unit-тестах; в production
    // ENCRYPTION_KEY должен быть явно задан.
    return deriveEncryptionKey('test-only-encryption-key-do-not-use-in-prod');
  }

  throw new Error(
    'ENCRYPTION_KEY не задан. Укажите 32+ байтный ключ в переменной окружения (см. .env.example).',
  );
}

export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString('base64');
}
