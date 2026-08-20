// Тесты на сами тестовые утилиты: если фабрики поедут, посыплется всё остальное.

import { describe, expect, it } from 'vitest';
import { makeClient, makeDiaryEntry, makeEnrollment } from './factories.js';
import { buildMockModel } from './mock-model.js';

describe('фабрики моделей', () => {
  it('подставляют значения по умолчанию и применяют overrides', () => {
    const entry = makeDiaryEntry({ description: 'Два яйца и кофе', approxCalories: 220 });

    expect(entry.clientEnrollmentId).toBe('enrollment-1');
    expect(entry.status).toBe('filled');
    expect(entry.description).toBe('Два яйца и кофе');
    expect(entry.approxCalories).toBe(220);
  });

  it('связывают клиента и enrollment одинаковыми идентификаторами по умолчанию', () => {
    expect(makeEnrollment().clientId).toBe(makeClient().id);
  });

  it('не переиспользуют вложенные объекты между вызовами', () => {
    const first = makeDiaryEntry();
    const second = makeDiaryEntry({ description: 'Салат' });

    expect(first.description).toBe('Овсянка с яблоком');
    expect(second.description).toBe('Салат');
  });
});

describe('buildMockModel', () => {
  it('фиксирует вызов update и применяет изменения к объекту', async () => {
    const model = buildMockModel({ status: 'needs_clarification', clarificationAttempts: 1 });

    await model.update({ status: 'filled', clarificationAttempts: 2 });

    expect(model.update).toHaveBeenCalledWith({ status: 'filled', clarificationAttempts: 2 });
    expect(model.status).toBe('filled');
    expect(model.clarificationAttempts).toBe(2);
  });
});
