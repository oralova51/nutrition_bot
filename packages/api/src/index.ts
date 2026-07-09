// Точка входа сервиса API (admin + internal endpoints).

import { closeDatabaseConnection, createLogger, LOG_EVENTS } from '@nutrition-bot/shared';
import { resolvePort } from './config.js';
import { createApiServer, HEALTH_PATH } from './server.js';

export const SERVICE_NAME = 'api';
export const logger = createLogger(SERVICE_NAME);

const server = createApiServer(logger);
const port = resolvePort();

server.listen(port, () => {
  logger.info(
    { event: LOG_EVENTS.SERVICE_STARTED, port, healthPath: HEALTH_PATH },
    `${SERVICE_NAME} service listening`,
  );
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down API service');

  server.close(() => {
    void closeDatabaseConnection()
      .then(() => {
        logger.info('API service stopped');
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'Error while closing database connection');
        process.exit(1);
      });
  });
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
