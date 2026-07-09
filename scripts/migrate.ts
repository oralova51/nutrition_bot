// CLI-раннер миграций БД: tsx scripts/migrate.ts <up|down|status>
// Единая база данных используется всеми сервисами (api, bot, scheduler),
// поэтому миграции и раннер хранятся на уровне репозитория, а не в пакете.

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

export type Migration = typeof umzug._types.migration;

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';

  switch (command) {
    case 'up':
      await umzug.up();
      break;
    case 'down':
      await umzug.down();
      break;
    case 'status': {
      const [executed, pending] = await Promise.all([umzug.executed(), umzug.pending()]);
      console.log(
        'Выполненные:',
        executed.map((m) => m.name),
      );
      console.log(
        'Ожидающие:',
        pending.map((m) => m.name),
      );
      break;
    }
    default:
      throw new Error(`Неизвестная команда "${command}". Используйте up | down | status.`);
  }
}

try {
  await main();
} finally {
  await sequelize.close();
}
