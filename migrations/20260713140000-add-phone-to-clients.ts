// Добавляем phone в таблицу clients с уникальным ограничением.
// phone опционален, но если задан — должен быть уникальным.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.addColumn('clients', 'phone', {
    type: DataTypes.STRING(255),
    allowNull: true,
    unique: true,
  });

  await queryInterface.addIndex('clients', ['phone'], {
    name: 'clients_phone_idx',
    unique: true,
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.removeIndex('clients', 'clients_phone_idx');
  await queryInterface.removeColumn('clients', 'phone');
};
