// Общие HTTP-утилиты API-сервиса: формат ошибки (adminAPI.md §1), отправка JSON,
// чтение и разбор тела запроса.

import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 64 * 1024;

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function sendApiError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.statusCode, {
    error: { code: error.code, message: error.message, details: error.details },
  });
}

function buildContentDisposition(filename: string): string {
  // Экранируем " и \ для совместимости, убираем переносы строк в ASCII-имени.
  // Для non-ASCII и спецсимволов используем RFC 5987 filename*.
  const escaped = filename
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '_')
    .replace(/\n/g, '_');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${escaped}"; filename*=UTF-8''${encoded}`;
}

export function sendCsv(
  res: ServerResponse,
  statusCode: number,
  filename: string,
  content: string,
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': buildContentDisposition(filename),
  });
  res.end(content);
}

/** Читает тело запроса и парсит его как JSON. Пустое тело → `{}`. */
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new ApiError(400, 'BODY_TOO_LARGE', 'Тело запроса превышает допустимый размер'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, 'INVALID_BODY', 'Тело запроса должно быть валидным JSON'));
      }
    });

    req.on('error', reject);
  });
}
