import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';

vi.mock('@nutrition-bot/shared', () => ({
  sendAdminAlert: vi.fn(),
}));

import { sendAdminAlert } from '@nutrition-bot/shared';
import { isRemoteHealthUrl, resolveHealthUrl, runUptimeMonitorJob } from './uptime-monitor-job.js';

const mockedSendAdminAlert = vi.mocked(sendAdminAlert);

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe('uptime monitor URL helpers', () => {
  it('treats empty API_HEALTH_URL as unset', () => {
    vi.stubEnv('API_HEALTH_URL', '');
    expect(resolveHealthUrl()).toBeUndefined();
  });

  it('rejects loopback hosts', () => {
    expect(isRemoteHealthUrl('http://localhost:3000/api/v1/health')).toBe(false);
    expect(isRemoteHealthUrl('http://127.0.0.1:3000/api/v1/health')).toBe(false);
  });

  it('accepts a public health URL', () => {
    expect(isRemoteHealthUrl('https://api.example.com/api/v1/health')).toBe(true);
  });
});

describe('runUptimeMonitorJob', () => {
  beforeEach(() => {
    mockedSendAdminAlert.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not alert when API_HEALTH_URL is unset', async () => {
    vi.stubEnv('API_HEALTH_URL', '');
    await runUptimeMonitorJob(createLogger());
    expect(mockedSendAdminAlert).not.toHaveBeenCalled();
  });

  it('does not alert for localhost', async () => {
    vi.stubEnv('API_HEALTH_URL', 'http://localhost:3000/api/v1/health');
    await runUptimeMonitorJob(createLogger());
    expect(mockedSendAdminAlert).not.toHaveBeenCalled();
  });

  it('alerts when a remote health check fails', async () => {
    vi.stubEnv('API_HEALTH_URL', 'https://api.example.com/api/v1/health');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await runUptimeMonitorJob(createLogger());

    expect(mockedSendAdminAlert).toHaveBeenCalledOnce();
    expect(mockedSendAdminAlert.mock.calls[0]?.[0]).toContain('api.example.com');
  });

  it('does not alert when remote health is ok', async () => {
    vi.stubEnv('API_HEALTH_URL', 'https://api.example.com/api/v1/health');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', database: 'connected', uptimeSeconds: 12 }),
      }),
    );

    await runUptimeMonitorJob(createLogger());
    expect(mockedSendAdminAlert).not.toHaveBeenCalled();
  });
});
