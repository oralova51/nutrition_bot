// CLI-раннер сброса БД: tsx scripts/reset-db.ts <soft|hard>
// soft — откатывает все миграции до нуля (таблицы удаляются, схема public остаётся)
// hard — DROP SCHEMA public CASCADE + пересоздание схемы и применение всех миграций

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SequelizeStorage, Umzug } from 'umzug';
import { getSequelize } from '../packages/shared/src/db/sequelize.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sequelize = getSequelize();

const umzug = new Umzug({
  migrations: { glob: path.join(repoRoot, 'migrations', '*.ts') },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: console,
});

async function resetSoft(): Promise<void> {
  console.log('Откат всех миграций (soft reset)...');
  let executed = await umzug.executed();
  while (executed.length > 0) {
    await umzug.down();
    executed = await umzug.executed();
  }
  console.log('Все миграции откачены.');
}

async function resetHard(): Promise<void> {
  console.log('Полная очистка схемы public (hard reset)...');
  await sequelize.query('DROP SCHEMA IF EXISTS public CASCADE');
  await sequelize.query('CREATE SCHEMA public');
  await sequelize.query('GRANT ALL ON SCHEMA public TO PUBLIC');
  console.log('Схема public пересоздана. Применяю миграции...');
  await umzug.up();
  console.log('Миграции применены.');
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'soft';
  if (mode !== 'soft' && mode !== 'hard') {
    throw new Error(`Неизвестный режим "${mode}". Используйте: soft | hard`);
  }

  const executedBefore = await umzug.executed();
  console.log(`Выполнено миграций до сброса: ${executedBefore.length}`);

  if (mode === 'soft') {
    await resetSoft();
  } else {
    await resetHard();
  }

  const [executedAfter, pendingAfter] = await Promise.all([umzug.executed(), umzug.pending()]);
  console.log(
    `Миграций после сброса: ${executedAfter.length} выполнено, ${pendingAfter.length} ожидает`,
  );
}

try {
  await main();
} finally {
  await sequelize.close();
}
