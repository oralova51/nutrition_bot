// Помощники для интеграционных тестов, которым нужна настоящая БД.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryTypes } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';
import { getSequelize } from '../db/sequelize.js';
import { ensureModelsInitialized } from '../models/index.js';

const MIGRATIONS_GLOB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../migrations/*.ts',
);

/** Служебная таблица umzug: в ней журнал миграций, её чистить нельзя. */
const PRESERVED_TABLES = ['SequelizeMeta'];

/**
 * Возвращает адрес тестовой базы или падает с инструкцией.
 * Вызывайте в начале интеграционного набора: без явно заданной тестовой базы
 * такие тесты должны не «тихо проходить», а сразу сообщать, чего не хватает.
 */
export function requireTestDatabase(): string {
  const url = process.env.TEST_DATABASE_URL;

  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL не задан. Создайте .env.test в корне репозитория и укажите отдельную ' +
        'тестовую базу: интеграционные тесты чистят данные между кейсами.',
    );
  }

  return url;
}

/**
 * Приводит схему тестовой базы к актуальной. umzug применяет только неисполненные
 * миграции, поэтому вызов идемпотентен и не требует ручного `npm run db:migrate`.
 */
export async function migrateTestDatabase(): Promise<void> {
  const sequelize = getSequelize();
  const umzug = new Umzug({
    migrations: { glob: MIGRATIONS_GLOB },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: undefined,
  });

  await umzug.up();
}

/** Проверяет адрес базы, инициализирует модели и накатывает миграции. */
export async function setupTestDatabase(): Promise<void> {
  requireTestDatabase();
  ensureModelsInitialized();
  await migrateTestDatabase();
}

/**
 * Чистит данные между кейсами. Список таблиц читается из схемы, а не задан
 * константой: иначе новая миграция тихо оставляла бы свои данные между тестами.
 */
export async function truncateTestDatabase(): Promise<void> {
  const sequelize = getSequelize();
  const rows = await sequelize.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    { type: QueryTypes.SELECT },
  );

  const tables = rows
    .map((row) => row.tablename)
    .filter((table) => !PRESERVED_TABLES.includes(table));

  if (tables.length === 0) {
    return;
  }

  const quoted = tables.map((table) => `"${table}"`).join(', ');
  await sequelize.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}
