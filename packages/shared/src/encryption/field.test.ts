import { describe, expect, it } from 'vitest';
import { decryptJson, decryptString, encryptJson, encryptString } from './field.js';

describe('field encryption', () => {
  it('encrypts and decrypts a string', () => {
    const plaintext = 'telegram-file-id-12345';
    const encrypted = encryptString(plaintext);
    expect(encrypted.v).toBe(1);
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.ct).toBeTruthy();
    expect(encrypted.at).toBeTruthy();
    expect(decryptString(encrypted)).toBe(plaintext);
  });

  it('encrypts and decrypts a JSON object', () => {
    const value = { name: 'Анна', age: 30, health: ['none'] };
    const encrypted = encryptJson(value);
    expect(decryptJson(encrypted)).toEqual(value);
  });

  it('returns null for null/undefined', () => {
    expect(decryptString(null)).toBeNull();
    expect(decryptString(undefined)).toBeNull();
    expect(decryptJson(null)).toBeNull();
  });

  it('returns legacy plain strings unchanged', () => {
    expect(decryptString('plain-file-id')).toBe('plain-file-id');
  });

  it('returns legacy plain JSON objects unchanged', () => {
    const legacy = { name: 'Анна' } as Record<string, unknown>;
    expect(decryptJson(legacy)).toEqual({ name: 'Анна' });
  });

  it('throws on tampered auth tag', () => {
    const encrypted = encryptString('secret');
    encrypted.at = Buffer.alloc(16).toString('base64');
    expect(() => decryptString(encrypted)).toThrow();
  });
});
