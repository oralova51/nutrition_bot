// Таблица clients — конечный пользователь (Telegram), см. SA/ERD.md §2 CLIENT.
// telegram_id nullable до активации enrollment-ссылки (adminAPI §4.3).

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('clients', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: queryInterface.sequelize.literal('gen_random_uuid()'),
    },
    first_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    last_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    telegram_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      unique: true,
    },
    telegram_username: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    registered_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('NOW()'),
    },
    last_interaction_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  await queryInterface.addIndex('clients', ['registered_at'], {
    name: 'clients_registered_at_idx',
  });

  await queryInterface.addIndex('clients', ['last_interaction_at'], {
    name: 'clients_last_interaction_at_idx',
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('clients');
};
