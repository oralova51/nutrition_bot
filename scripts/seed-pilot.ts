// Seed пилота (roadmap 12.1): 1 курс одной студии + тестовые enrollment под чек-листы CJM.
// Идемпотентен: повторный запуск без PILOT_SEED_FORCE=1 не дублирует данные.
// Запуск: npm run db:seed:pilot
//
// Сценарии клиентов:
// 1. happy           — active ссылка, готов к CJM 3–4 (подключение по deep link)
// 2. questionnaire   — анкета in_progress (альтернативная ветка ФТ-2)
// 3. expired_link    — ссылка истекла, telegram не привязан (ФТ-1 / ФТ-19)
// 4. inactivity      — уведомления выключены по inactivity (ФТ-10)
// 5. user_stop       — уведомления выключены по /stop (ФТ-12)

import { randomBytes } from 'node:crypto';
import {
  Client,
  ClientEnrollment,
  Course,
  EnrollmentLink,
  NotificationSettings,
  Questionnaire,
  closeDatabaseConnection,
  deleteClientData,
  getSequelize,
  initModels,
} from '@nutrition-bot/shared';

const COURSE_NAME = 'Пилот: коррекция фигуры 30 дней';
const COURSE_DURATION_DAYS = 30;
const CODE_PREFIX = 'enr_';
const LINK_EXPIRY_DAYS = 7;

/** Тестовые телефоны seed — префикс 7900120, чтобы не пересекаться с load-test. */
const SEED_CLIENTS = [
  {
    key: 'happy',
    firstName: 'Анна',
    lastName: 'Пилот-Happy',
    phone: '79001200001',
    email: 'pilot.happy@example.com',
  },
  {
    key: 'questionnaire',
    firstName: 'Марина',
    lastName: 'Пилот-Анкета',
    phone: '79001200002',
    email: 'pilot.questionnaire@example.com',
  },
  {
    key: 'expired_link',
    firstName: 'Ольга',
    lastName: 'Пилот-Ссылка',
    phone: '79001200003',
    email: 'pilot.expired@example.com',
  },
  {
    key: 'inactivity',
    firstName: 'Елена',
    lastName: 'Пилот-Тишина',
    phone: '79001200004',
    email: 'pilot.inactivity@example.com',
  },
  {
    key: 'user_stop',
    firstName: 'Ирина',
    lastName: 'Пилот-Stop',
    phone: '79001200005',
    email: 'pilot.stop@example.com',
  },
] as const;

type SeedClientKey = (typeof SEED_CLIENTS)[number]['key'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysToIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function generateLinkCode(): string {
  return randomBytes(12).toString('base64url');
}

function buildDeepLinkUrl(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${CODE_PREFIX}${code}`;
}

function resolveBotUsername(): string {
  return process.env.BOT_USERNAME?.trim() || 'nutrition_bot';
}

function forceReseed(): boolean {
  return process.env.PILOT_SEED_FORCE === '1';
}

interface SeededRow {
  key: SeedClientKey;
  clientId: string;
  enrollmentId: string;
  linkCode: string | null;
  linkUrl: string | null;
  notes: string;
}

async function createCourse(startDate: string): Promise<Course> {
  const endDate = addDaysToIsoDate(startDate, COURSE_DURATION_DAYS);
  return Course.create({
    name: COURSE_NAME,
    durationDays: COURSE_DURATION_DAYS,
    startDate,
    endDate,
  });
}

async function createClientWithEnrollment(
  course: Course,
  seed: (typeof SEED_CLIENTS)[number],
  startDate: string,
): Promise<{ client: Client; enrollment: ClientEnrollment }> {
  const endDate = addDaysToIsoDate(startDate, course.durationDays);

  return getSequelize().transaction(async (transaction) => {
    const client = await Client.create(
      {
        firstName: seed.firstName,
        lastName: seed.lastName,
        email: seed.email,
        phone: seed.phone,
      },
      { transaction },
    );

    await NotificationSettings.create({ clientId: client.id }, { transaction });

    const enrollment = await ClientEnrollment.create(
      {
        clientId: client.id,
        courseId: course.id,
        startDate,
        endDate,
      },
      { transaction },
    );

    return { client, enrollment };
  });
}

async function createActiveLink(enrollmentId: string): Promise<EnrollmentLink> {
  return EnrollmentLink.create({
    enrollmentId,
    code: generateLinkCode(),
    expiresAt: new Date(Date.now() + LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    status: 'active',
  });
}

async function createExpiredLink(enrollmentId: string): Promise<EnrollmentLink> {
  return EnrollmentLink.create({
    enrollmentId,
    code: generateLinkCode(),
    expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    status: 'expired',
  });
}

/** Фиктивный telegramId в диапазоне, зарезервированном под seed (строка — BIGINT в PG). */
function seedTelegramId(offset: number): string {
  return String(9_000_000_000 + offset);
}

async function applyScenario(
  key: SeedClientKey,
  client: Client,
  enrollment: ClientEnrollment,
  botUsername: string,
): Promise<Omit<SeededRow, 'clientId' | 'enrollmentId' | 'key'>> {
  switch (key) {
    case 'happy': {
      const link = await createActiveLink(enrollment.id);
      return {
        linkCode: `${CODE_PREFIX}${link.code}`,
        linkUrl: buildDeepLinkUrl(botUsername, link.code),
        notes: 'Active ссылка — подключение по deep link (CJM 3–4)',
      };
    }
    case 'questionnaire': {
      await client.update({ telegramId: seedTelegramId(2) });
      await enrollment.update({ onboardingStatus: 'in_progress' });
      await Questionnaire.create({
        clientEnrollmentId: enrollment.id,
        clientId: client.id,
        answers: { name: 'Марина', age: 32 },
        currentQuestion: 2,
        status: 'in_progress',
        lastAnswerAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
      });
      return {
        linkCode: null,
        linkUrl: null,
        notes: 'Анкета на вопросе 3/10, lastAnswerAt −30 ч (ФТ-2 reminder)',
      };
    }
    case 'expired_link': {
      const link = await createExpiredLink(enrollment.id);
      return {
        linkCode: `${CODE_PREFIX}${link.code}`,
        linkUrl: buildDeepLinkUrl(botUsername, link.code),
        notes: 'Ссылка expired, telegram не привязан — regenerate (ФТ-1/19)',
      };
    }
    case 'inactivity': {
      await client.update({
        telegramId: seedTelegramId(4),
        lastInteractionAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      });
      await enrollment.update({ onboardingStatus: 'completed' });
      await NotificationSettings.update(
        { enabled: false, disabledReason: 'inactivity' },
        { where: { clientId: client.id } },
      );
      return {
        linkCode: null,
        linkUrl: null,
        notes: 'Уведомления off (inactivity) — проверка ФТ-10/11',
      };
    }
    case 'user_stop': {
      await client.update({ telegramId: seedTelegramId(5) });
      await enrollment.update({ onboardingStatus: 'completed' });
      await NotificationSettings.update(
        { enabled: false, disabledReason: 'user_request' },
        { where: { clientId: client.id } },
      );
      return {
        linkCode: null,
        linkUrl: null,
        notes: 'Уведомления off (user_request) — проверка ФТ-12',
      };
    }
    default: {
      throw new Error(`Unknown seed scenario: ${String(key)}`);
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.ENCRYPTION_KEY?.trim()) {
    throw new Error(
      'ENCRYPTION_KEY не задан. Нужен для Questionnaire (этап 11). См. .env.example — сгенерируйте ключ и добавьте в .env.',
    );
  }

  initModels(getSequelize());
  const botUsername = resolveBotUsername();
  const startDate = todayIso();

  const existingCourse = await Course.findOne({ where: { name: COURSE_NAME } });
  if (existingCourse && !forceReseed()) {
    console.log(
      JSON.stringify(
        {
          status: 'skipped',
          reason: `Курс «${COURSE_NAME}» уже есть (id=${existingCourse.id}). Для пересоздания: PILOT_SEED_FORCE=1 npm run db:seed:pilot`,
          courseId: existingCourse.id,
        },
        null,
        2,
      ),
    );
    await closeDatabaseConnection();
    return;
  }

  if (existingCourse && forceReseed()) {
    // Удаляем только seed-клиентов по телефонам и сам курс; реальные пилотные данные не трогаем.
    const phones = SEED_CLIENTS.map((c) => c.phone);
    const seedClients = await Client.findAll({ where: { phone: phones } });
    for (const client of seedClients) {
      await deleteClientData(client.id);
    }
    await existingCourse.destroy();
    console.log('PILOT_SEED_FORCE=1: удалены предыдущие seed-клиенты и курс.');
  }

  const course = await createCourse(startDate);
  const rows: SeededRow[] = [];

  for (const seed of SEED_CLIENTS) {
    const { client, enrollment } = await createClientWithEnrollment(course, seed, startDate);
    const scenario = await applyScenario(seed.key, client, enrollment, botUsername);
    rows.push({
      key: seed.key,
      clientId: client.id,
      enrollmentId: enrollment.id,
      ...scenario,
    });
  }

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        studio: '1 студия (MVP-контекст, отдельной сущности Studio нет)',
        course: {
          id: course.id,
          name: course.name,
          durationDays: course.durationDays,
          startDate: course.startDate,
          endDate: course.endDate,
        },
        clients: rows,
        next: [
          'Happy path: откройте clients[0].linkUrl в Telegram',
          'Чек-листы: SA/stage12-pilot.md',
          'Метрики: npm run pilot:metrics',
        ],
      },
      null,
      2,
    ),
  );

  await closeDatabaseConnection();
}

void main().catch(async (err: unknown) => {
  console.error('Pilot seed failed:', err);
  await closeDatabaseConnection().catch(() => undefined);
  process.exit(1);
});
