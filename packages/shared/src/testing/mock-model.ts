// Базовый конструктор поддельных экземпляров Sequelize-моделей для unit-тестов.
// Не предназначен для production-кода: модуль доступен только через
// подпуть `@nutrition-bot/shared/testing` и импортирует vitest.

import { vi, type Mock } from 'vitest';

/** Поля сущности плюс замоканные методы экземпляра модели. */
export type MockModel<T> = T & {
  update: Mock;
  save: Mock;
  destroy: Mock;
  reload: Mock;
};

/**
 * Собирает объект, ведущий себя как загруженный экземпляр модели.
 * `update` не только фиксируется как вызов, но и применяет изменения к объекту —
 * поэтому в тесте можно проверять и аргументы вызова, и итоговое состояние сущности.
 */
export function buildMockModel<T extends object>(attributes: T): MockModel<T> {
  const model = { ...attributes } as unknown as MockModel<T>;

  return Object.assign(model, {
    update: vi.fn((values: Partial<T>) => {
      Object.assign(model, values);
      return Promise.resolve(model);
    }),
    save: vi.fn(() => Promise.resolve(model)),
    destroy: vi.fn(() => Promise.resolve()),
    reload: vi.fn(() => Promise.resolve(model)),
  });
}
