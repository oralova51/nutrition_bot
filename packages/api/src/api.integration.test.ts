// Интеграционные тесты admin API (roadmap 13.5, ФТ-19, ФТ-1).
// Ничего не мокается: сервер поднимается на случайном порту и опрашивается через
// fetch, запросы идут в настоящую тестовую БД. Проверяются контракты границы —
// admin-auth, формат ошибки, валидация, коды конфликтов жизненного цикла ссылки.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ClientEnrollment,
  closeDatabaseConnection,
  createLogger,
  getSequelize,
  NotificationSettings,
} from '@nutrition-bot/shared';
import { setupTestDatabase, truncateTestDatabase } from '@nutrition-bot/shared/testing';
import { createApiServer } from './server.js';

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN ?? '';
/** Валидный UUID, которого нет в базе: несуществующий формат дал бы ошибку драйвера, а не 404. */
const MISSING_UUID = '00000000-0000-0000-0000-000000000000';

let server: Server;
let baseUrl: string;

interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

async function request(
  method: string,
  path: string,
  options: { body?: unknown; token?: string | null } = {},
): Promise<{ status: number; body: unknown }> {
  const token = options.token === undefined ? ADMIN_TOKEN : options.token;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined
      ? {}
      : { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) }),
  });

  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
}

/** Курс + клиент + активный enrollment через публичные эндпоинты. */
async function seedEnrollment(): Promise<{ courseId: string; enrollmentId: string }> {
  const course = await request('POST', '/admin/courses', {
    body: { name: 'Курс 30 дней', durationDays: 30, startDate: '2026-02-01' },
  });
  const courseId = (course.body as { id: string }).id;

  const client = await request('POST', '/admin/clients', {
    body: {
      firstName: 'Анна',
      lastName: 'Иванова',
      courseId,
      enrollmentStartDate: '2026-02-01',
    },
  });
  const enrollmentId = (client.body as { enrollment: { id: string } }).enrollment.id;

  return { courseId, enrollmentId };
}

async function createLink(
  enrollmentId: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: unknown }> {
  return request('POST', `/admin/enrollments/${enrollmentId}/link`, { body });
}

beforeAll(async () => {
  await setupTestDatabase();

  server = createApiServer(createLogger('api'));
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/v1`;
});

afterAll(async () => {
  // Сервер может остаться неподнятым, если beforeAll упал на подготовке базы —
  // тогда не подменяем исходную ошибку падением самого teardown.
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  await closeDatabaseConnection();
});

beforeEach(async () => {
  await truncateTestDatabase();
});

describe('admin-auth и маршрутизация', () => {
  it('отдаёт health без токена', async () => {
    const { status, body } = await request('GET', '/health', { token: null });

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'ok' });
  });

  it('требует Authorization на admin-эндпоинтах', async () => {
    const { status, body } = await request('GET', '/admin/courses', { token: null });
    const { error } = body as ApiErrorBody;

    expect(status).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.message).toContain('Authorization');
    expect(error.details).toEqual({});
  });

  it('отклоняет неверный admin-токен', async () => {
    const { status, body } = await request('GET', '/admin/courses', { token: 'wrong-token' });

    expect(status).toBe(401);
    expect((body as ApiErrorBody).error.code).toBe('UNAUTHORIZED');
  });

  it('на неизвестный маршрут отвечает 404 в общем формате ошибки', async () => {
    const { status, body } = await request('GET', '/admin/unknown');

    expect(status).toBe(404);
    expect((body as ApiErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('не путает литеральный expired-links с :enrollmentId', async () => {
    const { status, body } = await request('GET', '/admin/enrollments/expired-links');

    expect(status).toBe(200);
    expect(body).toMatchObject({ data: [], pagination: { page: 1, limit: 20, total: 0 } });
  });
});

describe('валидация тела и query-параметров', () => {
  it('требует обязательные поля курса', async () => {
    const { status, body } = await request('POST', '/admin/courses', {
      body: { durationDays: 30, startDate: '2026-02-01' },
    });

    const { error } = body as ApiErrorBody;

    expect(status).toBe(400);
    expect(error.code).toBe('INVALID_BODY');
    expect(error.message).toContain('name');
  });

  it('отклоняет несуществующую дату', async () => {
    const { status, body } = await request('POST', '/admin/courses', {
      body: { name: 'Курс', durationDays: 30, startDate: '2026-02-30' },
    });

    expect(status).toBe(400);
    expect((body as ApiErrorBody).error.code).toBe('INVALID_BODY');
  });

  it('отклоняет неположительную длительность курса', async () => {
    const { status } = await request('POST', '/admin/courses', {
      body: { name: 'Курс', durationDays: 0, startDate: '2026-02-01' },
    });

    expect(status).toBe(400);
  });

  it('отклоняет битый JSON в теле', async () => {
    const { status, body } = await request('POST', '/admin/courses', { body: '{"name":' });

    expect(status).toBe(400);
    expect((body as ApiErrorBody).error.code).toBe('INVALID_BODY');
  });

  it('отклоняет нулевую страницу в пагинации', async () => {
    const { status, body } = await request('GET', '/admin/clients?page=0');

    expect(status).toBe(400);
    expect((body as ApiErrorBody).error.code).toBe('INVALID_PARAMS');
  });

  it('ограничивает limit максимумом вместо ошибки', async () => {
    const { status, body } = await request('GET', '/admin/clients?limit=1000');

    expect(status).toBe(200);
    expect(body).toMatchObject({ pagination: { limit: 100 } });
  });

  it('отклоняет неизвестное значение фильтра', async () => {
    const { status, body } = await request('GET', '/admin/clients?linkStatus=whatever');

    expect(status).toBe(400);
    expect((body as ApiErrorBody).error.code).toBe('INVALID_PARAMS');
  });
});

describe('курсы и клиенты', () => {
  it('создаёт курс и считает дату окончания от длительности', async () => {
    const { status, body } = await request('POST', '/admin/courses', {
      body: { name: 'Курс 30 дней', durationDays: 30, startDate: '2026-02-01' },
    });

    expect(status).toBe(201);
    expect(body).toMatchObject({
      name: 'Курс 30 дней',
      durationDays: 30,
      startDate: '2026-02-01',
      endDate: '2026-03-03',
    });
  });

  it('не видит данных предыдущего кейса', async () => {
    const { body } = await request('GET', '/admin/courses');

    expect(body).toEqual({ data: [] });
  });

  it('создаёт клиента с enrollment и настройками уведомлений по умолчанию', async () => {
    const { courseId } = await seedEnrollment();

    const list = await request('GET', '/admin/clients');
    const created = (list.body as { data: { id: string }[] }).data[0];
    const detail = await request('GET', `/admin/clients/${created?.id ?? ''}`);

    expect(list.status).toBe(200);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      firstName: 'Анна',
      telegramId: null,
      enrollments: [{ courseId, courseName: 'Курс 30 дней', status: 'active' }],
      onboarding: { status: 'pending' },
      notifications: { enabled: true, timezone: 'Europe/Kaliningrad' },
    });
    // В ответе `notifications` имеет те же значения по умолчанию и без строки в БД,
    // поэтому саму строку (SA_SUMMARY §4, правило 3) проверяем напрямую.
    await expect(
      NotificationSettings.count({ where: { clientId: created?.id ?? '' } }),
    ).resolves.toBe(1);
  });

  it('не создаёт клиента для несуществующего курса', async () => {
    const { status, body } = await request('POST', '/admin/clients', {
      body: {
        firstName: 'Анна',
        lastName: 'Иванова',
        courseId: MISSING_UUID,
        enrollmentStartDate: '2026-02-01',
      },
    });

    expect(status).toBe(404);
    expect((body as ApiErrorBody).error.code).toBe('COURSE_NOT_FOUND');
  });

  it('отдаёт 404 на неизвестного клиента', async () => {
    const { status, body } = await request('GET', `/admin/clients/${MISSING_UUID}`);

    expect(status).toBe(404);
    expect((body as ApiErrorBody).error.code).toBe('CLIENT_NOT_FOUND');
  });
});

describe('ссылки приглашения', () => {
  it('выдаёт одноразовую ссылку со сроком 7 дней', async () => {
    const { enrollmentId } = await seedEnrollment();

    const { status, body } = await createLink(enrollmentId);
    const link = (body as { link: { code: string; url: string; expiresAt: string } }).link;
    const daysToExpiry = (new Date(link.expiresAt).getTime() - Date.now()) / 86_400_000;

    expect(status).toBe(201);
    expect(link.code).toMatch(/^enr_/);
    expect(link.url).toContain('https://t.me/');
    expect(daysToExpiry).toBeGreaterThan(6.9);
    expect(daysToExpiry).toBeLessThan(7.1);
  });

  it('не выдаёт вторую активную ссылку без force', async () => {
    const { enrollmentId } = await seedEnrollment();
    await createLink(enrollmentId);

    const { status, body } = await createLink(enrollmentId);

    expect(status).toBe(409);
    expect((body as ApiErrorBody).error.code).toBe('ACTIVE_LINK_EXISTS');
  });

  it('с force отзывает прежнюю ссылку и выдаёт новую', async () => {
    const { enrollmentId } = await seedEnrollment();
    const first = await createLink(enrollmentId);
    const firstId = (first.body as { link: { id: string } }).link.id;

    const second = await createLink(enrollmentId, { force: true });
    const secondId = (second.body as { link: { id: string } }).link.id;
    const info = await request('GET', `/admin/enrollments/${enrollmentId}/link`);
    const view = info.body as {
      active: { id: string } | null;
      history: { id: string; status: string }[];
    };

    expect(second.status).toBe(201);
    expect(view.active?.id).toBe(secondId);
    expect(view.history).toEqual([expect.objectContaining({ id: firstId, status: 'revoked' })]);
  });

  it('отклоняет нестроковый force', async () => {
    const { enrollmentId } = await seedEnrollment();

    const { status, body } = await createLink(enrollmentId, { force: 'yes' });

    expect(status).toBe(400);
    expect((body as ApiErrorBody).error.code).toBe('INVALID_BODY');
  });

  it('не перевыпускает ссылку, пока прежняя ещё действует', async () => {
    const { enrollmentId } = await seedEnrollment();
    await createLink(enrollmentId);

    const { status, body } = await request(
      'POST',
      `/admin/enrollments/${enrollmentId}/link/regenerate`,
      { body: {} },
    );

    expect(status).toBe(422);
    expect((body as ApiErrorBody).error.code).toBe('LINK_STILL_ACTIVE');
  });

  it('отдаёт 404 на неизвестный enrollment', async () => {
    const { status, body } = await createLink(MISSING_UUID);

    expect(status).toBe(404);
    expect((body as ApiErrorBody).error.code).toBe('ENROLLMENT_NOT_FOUND');
  });

  it('не выдаёт ссылку на неактивный enrollment', async () => {
    const { enrollmentId } = await seedEnrollment();
    const enrollment = await ClientEnrollment.findByPk(enrollmentId);
    await enrollment?.update({ status: 'completed' });

    const { status, body } = await createLink(enrollmentId);
    const { error } = body as ApiErrorBody;

    expect(status).toBe(422);
    expect(error.code).toBe('ENROLLMENT_NOT_ACTIVE');
    // Подсказка про новый enrollment — часть контракта: без неё админ не знает,
    // что делать с завершённым курсом (adminAPI.md §4.4).
    expect(error.message).toContain('POST /admin/clients/');
  });

  it('отзывает активную ссылку и не позволяет отозвать её дважды', async () => {
    const { enrollmentId } = await seedEnrollment();
    const created = await createLink(enrollmentId);
    const linkId = (created.body as { link: { id: string } }).link.id;

    const first = await request('DELETE', `/admin/enrollments/${enrollmentId}/link/${linkId}`);
    const second = await request('DELETE', `/admin/enrollments/${enrollmentId}/link/${linkId}`);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'revoked' });
    expect(second.status).toBe(422);
    expect((second.body as ApiErrorBody).error.code).toBe('LINK_NOT_ACTIVE');
  });

  it('после regenerate истёкшей ссылки активной становится новая', async () => {
    const { enrollmentId } = await seedEnrollment();
    const created = await createLink(enrollmentId);
    const linkId = (created.body as { link: { id: string } }).link.id;
    // Ленивое истечение: срок в прошлом, статус ещё active — как у ссылки,
    // которой клиент не воспользовался.
    await getSequelize().query(
      "UPDATE enrollment_links SET expires_at = now() - interval '1 day' WHERE id = :linkId",
      { replacements: { linkId } },
    );

    const regenerated = await request(
      'POST',
      `/admin/enrollments/${enrollmentId}/link/regenerate`,
      { body: {} },
    );
    const info = await request('GET', `/admin/enrollments/${enrollmentId}/link`);
    const view = info.body as {
      active: { id: string } | null;
      history: { id: string; status: string }[];
    };

    expect(regenerated.status).toBe(201);
    expect(view.active?.id).not.toBe(linkId);
    expect(view.history).toEqual([expect.objectContaining({ id: linkId, status: 'expired' })]);
  });
});
