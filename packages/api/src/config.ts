// Конфигурация API-сервиса (порт, версия для health-check).

export const API_VERSION = '0.1.0';

const DEFAULT_PORT = 3000;

export function resolvePort(): number {
  const raw = process.env.PORT;
  if (!raw) {
    return DEFAULT_PORT;
  }

  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT должен быть целым числом 1–65535, получено: "${raw}"`);
  }

  return port;
}
