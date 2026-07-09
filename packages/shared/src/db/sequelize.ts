// Подключение к PostgreSQL (Supabase) через Sequelize.
// Экземпляр создаётся лениво при первом обращении, чтобы импорт пакета
// не требовал наличия DATABASE_URL там, где к БД не обращаются.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvFile } from 'dotenv';
import { Sequelize } from 'sequelize';

// Загружаем .env из корня монорепо один раз при первом обращении к модулю —
// это позволяет запускать сервисы и скрипты (миграции) независимо от cwd.
loadEnvFile({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.env'),
});

let sequelizeInstance: Sequelize | undefined;

function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL не задан. Укажите переменную окружения (см. .env.example).');
  }
  return databaseUrl;
}

// Supabase и другие облачные Postgres требуют SSL; локальную БД для разработки
// (localhost/127.0.0.1) поднимаем без него.
function isLocalDatabase(databaseUrl: string): boolean {
  return /(?:localhost|127\.0\.0\.1)/.test(databaseUrl);
}

function createSequelize(): Sequelize {
  const databaseUrl = resolveDatabaseUrl();

  return new Sequelize(databaseUrl, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: isLocalDatabase(databaseUrl)
      ? {}
      : { ssl: { require: true, rejectUnauthorized: false } },
    pool: {
      max: 10,
      min: 0,
      acquire: 30_000,
      idle: 10_000,
    },
  });
}

export function getSequelize(): Sequelize {
  sequelizeInstance ??= createSequelize();
  return sequelizeInstance;
}

export async function checkDatabaseConnection(): Promise<void> {
  await getSequelize().authenticate();
}

export async function closeDatabaseConnection(): Promise<void> {
  if (sequelizeInstance) {
    await sequelizeInstance.close();
    sequelizeInstance = undefined;
  }
}
