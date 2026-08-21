// nonFR §3 / roadmap 11.2: удаление данных клиентов, у которых последний курс
// завершился раньше срока хранения.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nutrition-bot/shared', () => ({
  ClientEnrollment: { findAll: vi.fn() },
  deleteClientData: vi.fn(),
  getSequelize: () => ({ fn: vi.fn(), col: vi.fn() }),
}));

import { ClientEnrollment, deleteClientData } from '@nutrition-bot/shared';
import { makeTestLogger } from '@nutrition-bot/shared/testing';
import { runDataRetentionJob } from './data-retention-job.js';

const NOW = new Date('2026-01-15T09:00:00.000Z');

function arrangeGroups(...groups: Array<{ clientId: string; maxEndDate: string }>): void {
  vi.mocked(ClientEnrollment.findAll).mockResolvedValue(groups as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(deleteClientData).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('runDataRetentionJob', () => {
  it('удаляет клиента, чей последний курс завершился раньше срока хранения', async () => {
    // Срок по умолчанию — 12 месяцев, отсечка на 2025-01-15.
    arrangeGroups({ clientId: 'client-old', maxEndDate: '2024-12-31' });

    const result = await runDataRetentionJob(makeTestLogger());

    expect(deleteClientData).toHaveBeenCalledWith('client-old');
    expect(result).toMatchObject({ job: 'data-retention', considered: 1, sent: 1, errors: 0 });
  });

  it('не трогает клиента, чей курс завершился внутри срока хранения', async () => {
    arrangeGroups({ clientId: 'client-recent', maxEndDate: '2025-06-30' });

    const result = await runDataRetentionJob(makeTestLogger());

    expect(deleteClientData).not.toHaveBeenCalled();
    expect(result).toMatchObject({ considered: 0, sent: 0 });
  });

  it('берёт срок хранения из DATA_RETENTION_MONTHS', async () => {
    vi.stubEnv('DATA_RETENTION_MONTHS', '6');
    arrangeGroups({ clientId: 'client-recent', maxEndDate: '2025-06-30' });

    await runDataRetentionJob(makeTestLogger());

    // Отсечка сдвинулась на 2025-07-15 — курс, завершившийся 30 июня, уже вне срока.
    expect(deleteClientData).toHaveBeenCalledWith('client-recent');
  });

  it('некорректный DATA_RETENTION_MONTHS откатывается к 12 месяцам', async () => {
    vi.stubEnv('DATA_RETENTION_MONTHS', '0');
    arrangeGroups({ clientId: 'client-recent', maxEndDate: '2025-06-30' });

    await runDataRetentionJob(makeTestLogger());

    expect(deleteClientData).not.toHaveBeenCalled();
  });

  it('ошибка удаления одного клиента не мешает остальным', async () => {
    arrangeGroups(
      { clientId: 'client-1', maxEndDate: '2024-01-01' },
      { clientId: 'client-2', maxEndDate: '2024-01-01' },
    );
    vi.mocked(deleteClientData)
      .mockRejectedValueOnce(new Error('нарушение внешнего ключа'))
      .mockResolvedValueOnce(undefined);

    const logger = makeTestLogger();
    const result = await runDataRetentionJob(logger);

    expect(result).toMatchObject({ considered: 2, sent: 1, skipped: 1, errors: 1 });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('идемпотентен: удалённые клиенты больше не попадают в выборку', async () => {
    arrangeGroups({ clientId: 'client-old', maxEndDate: '2024-12-31' });
    await runDataRetentionJob(makeTestLogger());

    arrangeGroups();
    const result = await runDataRetentionJob(makeTestLogger());

    expect(result).toMatchObject({ considered: 0, sent: 0 });
    expect(deleteClientData).toHaveBeenCalledOnce();
  });
});
