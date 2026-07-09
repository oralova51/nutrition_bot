// Расширение pgcrypto нужно для gen_random_uuid() — все первичные ключи
// в домене (см. SA/ERD.md) типа UUID.

import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query('DROP EXTENSION IF EXISTS "pgcrypto";');
};
