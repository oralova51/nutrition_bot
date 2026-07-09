// Таблица enrollment_link_attempts — лог попыток использования ссылки-приглашения (ФТ-1).
// См. SA/adminAPI.md §3. link_id nullable + onDelete SET NULL: попытка логируется
// даже для кода, для которого не нашлось соответствующей ссылки (result=invalid_code).

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('enrollment_link_attempts', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: queryInterface.sequelize.literal('gen_random_uuid()'),
    },
    link_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'enrollment_links',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    attempted_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('NOW()'),
    },
    telegram_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    result: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE enrollment_link_attempts
      ADD CONSTRAINT enrollment_link_attempts_result_valid
        CHECK (result IN ('success', 'expired', 'already_used', 'invalid_code', 'enrollment_cancelled'));
  `);

  await queryInterface.addIndex('enrollment_link_attempts', ['link_id'], {
    name: 'enrollment_link_attempts_link_id_idx',
  });

  await queryInterface.addIndex('enrollment_link_attempts', ['attempted_at'], {
    name: 'enrollment_link_attempts_attempted_at_idx',
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('enrollment_link_attempts');
};
