// Roadmap 10.8: алерт о массовых сбоях доставки — порог, окно подсчёта
// и минимальный интервал между алертами.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Op } from 'sequelize';

vi.mock('@nutrition-bot/shared', () => ({
  Message: { count: vi.fn() },
  sendAdminAlert: vi.fn(),
}));

import { Message, sendAdminAlert } from '@nutrition-bot/shared';
import { makeTestLogger } from '@nutrition-bot/shared/testing';
import {
  createDeliveryFailureAlertState,
  runDeliveryFailureAlertJob,
  type DeliveryFailureAlertState,
} from './delivery-failure-alert-job.js';

const NOW = new Date('2026-01-15T09:00:00.000Z');
const MINUTE_MS = 60 * 1000;

let state: DeliveryFailureAlertState;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(sendAdminAlert).mockResolvedValue(undefined);
  // Дедуп живёт в памяти процесса, поэтому каждому кейсу — своё состояние.
  state = createDeliveryFailureAlertState();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('runDeliveryFailureAlertJob: порог и окно', () => {
  it('молчит, пока сбоев меньше порога', async () => {
    vi.stubEnv('MASS_FAILURE_THRESHOLD', '5');
    vi.mocked(Message.count).mockResolvedValue(4);

    await runDeliveryFailureAlertJob(makeTestLogger(), state);

    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it('алертит при достижении порога и указывает количество', async () => {
    vi.stubEnv('MASS_FAILURE_THRESHOLD', '5');
    vi.mocked(Message.count).mockResolvedValue(5);

    await runDeliveryFailureAlertJob(makeTestLogger(), state);

    expect(sendAdminAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAdminAlert).mock.calls[0]?.[0]).toContain('5');
  });

  it('считает сбои за окно MASS_FAILURE_WINDOW_MINUTES', async () => {
    vi.stubEnv('MASS_FAILURE_WINDOW_MINUTES', '15');
    vi.mocked(Message.count).mockResolvedValue(0);

    await runDeliveryFailureAlertJob(makeTestLogger(), state);

    const where = vi.mocked(Message.count).mock.calls[0]?.[0]?.where as {
      deliveryStatus: string;
      createdAt: { [Op.gte]: Date };
    };
    expect(where.deliveryStatus).toBe('delivery_failed');
    expect(where.createdAt[Op.gte].toISOString()).toBe('2026-01-15T08:45:00.000Z');
  });

  it('нечисловые и неположительные значения env откатываются к дефолтам', async () => {
    vi.stubEnv('MASS_FAILURE_WINDOW_MINUTES', 'не число');
    vi.stubEnv('MASS_FAILURE_THRESHOLD', '0');
    vi.mocked(Message.count).mockResolvedValue(4);

    await runDeliveryFailureAlertJob(makeTestLogger(), state);

    // Дефолты: окно 30 минут, порог 5 — четырёх сбоев не хватает.
    const where = vi.mocked(Message.count).mock.calls[0]?.[0]?.where as {
      createdAt: { [Op.gte]: Date };
    };
    expect(where.createdAt[Op.gte].toISOString()).toBe('2026-01-15T08:30:00.000Z');
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });
});

describe('runDeliveryFailureAlertJob: интервал между алертами', () => {
  beforeEach(() => {
    vi.stubEnv('MASS_FAILURE_THRESHOLD', '5');
    vi.stubEnv('MASS_FAILURE_ALERT_INTERVAL_MINUTES', '60');
    vi.mocked(Message.count).mockResolvedValue(10);
  });

  it('не будит администратора повторно внутри интервала', async () => {
    await runDeliveryFailureAlertJob(makeTestLogger(), state);
    expect(sendAdminAlert).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(59 * MINUTE_MS);
    await runDeliveryFailureAlertJob(makeTestLogger(), state);

    expect(sendAdminAlert).toHaveBeenCalledOnce();
  });

  it('алертит снова, когда интервал истёк', async () => {
    await runDeliveryFailureAlertJob(makeTestLogger(), state);

    vi.advanceTimersByTime(60 * MINUTE_MS);
    await runDeliveryFailureAlertJob(makeTestLogger(), state);

    expect(sendAdminAlert).toHaveBeenCalledTimes(2);
  });

  it('состояние не течёт между независимыми запусками job', async () => {
    await runDeliveryFailureAlertJob(makeTestLogger(), state);

    // Свежее состояние = перезапуск процесса: интервал начинается заново.
    await runDeliveryFailureAlertJob(makeTestLogger(), createDeliveryFailureAlertState());

    expect(sendAdminAlert).toHaveBeenCalledTimes(2);
  });

  it('сбой самого алерта не занимает слот интервала', async () => {
    vi.mocked(sendAdminAlert).mockRejectedValueOnce(new Error('Telegram недоступен'));

    const logger = makeTestLogger();
    await runDeliveryFailureAlertJob(logger, state);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(state.lastAlertSentAt).toBeNull();

    // Следующий запуск сразу же может попробовать снова.
    await runDeliveryFailureAlertJob(makeTestLogger(), state);
    expect(sendAdminAlert).toHaveBeenCalledTimes(2);
  });
});
