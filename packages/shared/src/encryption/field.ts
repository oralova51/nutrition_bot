// Шифрование полей БД: строк и JSON-объектов методом AES-256-GCM.
// Хранимый формат — JSON-объект с зашифрованным содержимым, IV и auth tag.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { resolveEncryptionKey } from './config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const CURRENT_FORMAT_VERSION = 1;

export interface EncryptedFieldValue {
  /** Версия формата, чтобы при необходимости поддержать миграцию. */
  v: number;
  /** IV (base64). */
  iv: string;
  /** Шифротекст (base64). */
  ct: string;
  /** Auth tag (base64). */
  at: string;
}

function isEncryptedFieldValue(value: unknown): value is EncryptedFieldValue {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<EncryptedFieldValue>;
  return (
    candidate.v === CURRENT_FORMAT_VERSION &&
    typeof candidate.iv === 'string' &&
    typeof candidate.ct === 'string' &&
    typeof candidate.at === 'string'
  );
}

export function encryptString(plaintext: string): EncryptedFieldValue {
  const key = resolveEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    v: CURRENT_FORMAT_VERSION,
    iv: iv.toString('base64'),
    ct: ciphertext.toString('base64'),
    at: authTag.toString('base64'),
  };
}

export function decryptString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  // Legacy: обычная строка, сохранённая до внедрения шифрования.
  if (typeof raw === 'string') {
    return raw;
  }

  if (!isEncryptedFieldValue(raw)) {
    // Неизвестный формат — не портим данные, возвращаем null.
    return null;
  }

  const key = resolveEncryptionKey();
  const iv = Buffer.from(raw.iv, 'base64');
  const ciphertext = Buffer.from(raw.ct, 'base64');
  const authTag = Buffer.from(raw.at, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function encryptJson(value: unknown): EncryptedFieldValue {
  return encryptString(JSON.stringify(value));
}

export function decryptJson(raw: unknown): unknown {
  if (raw !== null && typeof raw === 'object' && !isEncryptedFieldValue(raw)) {
    // Legacy plain JSON object stored before field-level encryption.
    return raw;
  }

  const plaintext = decryptString(raw);
  if (plaintext === null) return null;
  return JSON.parse(plaintext);
}

/** Сериализует зашифрованное значение в строку для хранения в TEXT-поле. */
export function serializeEncrypted(value: EncryptedFieldValue): string {
  return JSON.stringify(value);
}

/** Пытается распарсить зашифрованное значение из строки; возвращает исходную строку при ошибке. */
export function parseEncrypted(
  raw: string | null | undefined,
): EncryptedFieldValue | string | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isEncryptedFieldValue(parsed)) return parsed;
    return raw;
  } catch {
    return raw;
  }
}
