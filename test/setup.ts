// Глобальная подготовка окружения для всех тестов (vitest setupFiles).
// Задача — сделать прогон детерминированным и безопасным: тест не должен
// подключаться к боевой БД, отправлять реальные сообщения в Telegram
// или зависеть от того, что лежит в локальном .env разработчика.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Заведомо недоступный адрес: если тест случайно обратится к БД, он упадёт
// на подключении, а не уйдёт в боевую базу из корневого .env.
const UNCONFIGURED_DATABASE_URL =
  'postgresql://vitest:vitest@127.0.0.1:1/nutrition_bot_tests_not_configured';

function readEnvFile(fileName: string): Record<string, string> {
  const filePath = path.join(ROOT_DIR, fileName);
  if (!existsSync(filePath)) {
    return {};
  }
  return parse(readFileSync(filePath));
}

const testEnv = readEnvFile('.env.test');
const rootEnv = readEnvFile('.env');

for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] = value;
}

process.env.NODE_ENV = 'test';

// Системный пояс процесса фиксируем: scheduler-job'ы сравнивают локальное HH:mm
// клиента через toZonedTime, а это конструирование даты в поясе процесса.
// Без фиксации результат зависит от машины разработчика (и от DST-переходов в её поясе).
process.env.TZ = 'UTC';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (testDatabaseUrl && testDatabaseUrl === rootEnv.DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL совпадает с DATABASE_URL из .env. Заведите отдельную тестовую базу: ' +
      'интеграционные тесты чистят данные между кейсами и сотрут боевые.',
  );
}

// shared/db/sequelize.ts подгружает корневой .env через dotenv, а тот не перезаписывает
// уже заданные переменные — поэтому выставленное здесь переживёт его загрузку.
process.env.DATABASE_URL = testDatabaseUrl ?? UNCONFIGURED_DATABASE_URL;
process.env.TELEGRAM_API ??= '111111:vitest-fake-token-do-not-use';
process.env.ENCRYPTION_KEY ??= 'test-only-encryption-key-do-not-use-in-prod';
process.env.ADMIN_API_TOKEN ??= 'vitest-admin-token';
process.env.BOT_USERNAME ??= 'vitest_nutrition_bot';
