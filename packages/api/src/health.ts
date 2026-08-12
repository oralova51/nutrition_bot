// GET /api/v1/health — adminAPI.md §4.1, roadmap 1.10.

import { checkDatabaseConnection } from '@nutrition-bot/shared';
import { API_VERSION } from './config.js';

export interface HealthResponse {
  status: 'ok' | 'error';
  version: string;
  database: 'connected' | 'disconnected';
  uptimeSeconds: number;
}

export async function getHealthStatus(): Promise<HealthResponse> {
  try {
    await checkDatabaseConnection();
    return {
      status: 'ok',
      version: API_VERSION,
      database: 'connected',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  } catch {
    return {
      status: 'error',
      version: API_VERSION,
      database: 'disconnected',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
