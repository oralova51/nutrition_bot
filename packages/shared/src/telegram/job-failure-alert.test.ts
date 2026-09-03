import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./alerts.js', () => ({ sendAdminAlert: vi.fn() }));
vi.mock('../logging/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { sendAdminAlert } from './alerts.js';
import {
  createJobFailureAlertState,
  notifyAdminJobFailure,
  notifyAdminJobFailuresDigest,
} from './job-failure-alert.js';

const NOW = new Date('2026-01-15T09:00:00.000Z');

function quotaError(): Error {
  return Object.assign(new Error('You exceeded your current quota'), {
    status: 429,
    code: 'insufficient_quota',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(sendAdminAlert).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('notifyAdminJobFailure', () => {
  it('пишет админу, что рекомендация не создана, и называет биллинг', async () => {
    const state = createJobFailureAlertState();

    await notifyAdminJobFailure(
      {
        kind: 'recommendation',
        clientId: 'client-1',
        entryId: 'diary-1',
        err: quotaError(),
      },
      state,
    );

    expect(sendAdminAlert).toHaveBeenCalledOnce();
    const text = vi.mocked(sendAdminAlert).mock.calls[0]?.[0] ?? '';
    expect(text).toContain('Рекомендация не создана');
    expect(text).toContain('закончились деньги');
    expect(text).toContain('client-1');
    expect(text).toContain('diary-1');
  });

  it('не спамит тем же биллингом, пока не вышел интервал', async () => {
    vi.stubEnv('JOB_FAILURE_ALERT_INTERVAL_MINUTES', '60');
    const state = createJobFailureAlertState();

    await notifyAdminJobFailure(
      { kind: 'recommendation', clientId: 'client-1', err: quotaError() },
      state,
    );
    await notifyAdminJobFailure(
      { kind: 'recommendation', clientId: 'client-2', err: quotaError() },
      state,
    );

    expect(sendAdminAlert).toHaveBeenCalledOnce();
  });

  it('сбой самого алерта не занимает слот интервала', async () => {
    const state = createJobFailureAlertState();
    vi.mocked(sendAdminAlert).mockRejectedValueOnce(new Error('Telegram недоступен'));

    await notifyAdminJobFailure(
      { kind: 'recommendation', clientId: 'client-1', err: quotaError() },
      state,
    );
    await notifyAdminJobFailure(
      { kind: 'recommendation', clientId: 'client-1', err: quotaError() },
      state,
    );

    expect(sendAdminAlert).toHaveBeenCalledTimes(2);
  });
});

describe('notifyAdminJobFailuresDigest', () => {
  it('собирает несколько клиентов в один алерт', async () => {
    const state = createJobFailureAlertState();

    await notifyAdminJobFailuresDigest(
      'evening_summary',
      [
        { clientId: 'client-1', err: new Error('AI недоступен') },
        { clientId: 'client-2', err: new Error('AI недоступен') },
      ],
      state,
    );

    expect(sendAdminAlert).toHaveBeenCalledOnce();
    const text = vi.mocked(sendAdminAlert).mock.calls[0]?.[0] ?? '';
    expect(text).toContain('Вечерняя сводка не собралась');
    expect(text).toContain('client-1');
    expect(text).toContain('client-2');
    expect(text).toContain('отчёта нет');
  });

  it('для запасной сводки не пишет, что отчёта нет', async () => {
    const state = createJobFailureAlertState();

    await notifyAdminJobFailuresDigest(
      'evening_summary',
      [{ clientId: 'client-1', err: quotaError(), usedFallback: true }],
      state,
    );

    const text = vi.mocked(sendAdminAlert).mock.calls[0]?.[0] ?? '';
    expect(text).toContain('запасной текст');
    expect(text).not.toContain('отчёта нет');
    expect(text).toContain('закончились деньги');
  });

  it('молчит на пустой список', async () => {
    await notifyAdminJobFailuresDigest('evening_summary', [], createJobFailureAlertState());

    expect(sendAdminAlert).not.toHaveBeenCalled();
  });
});
