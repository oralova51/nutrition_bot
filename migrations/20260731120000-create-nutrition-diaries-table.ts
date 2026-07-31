// Таблица nutrition_diaries — записи о приёмах питания клиента.
// См. SA/ERD.md §2 NUTRITION_DIARY, ФТ-5, roadmap 4.8.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('nutrition_diaries', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: queryInterface.sequelize.literal('gen_random_uuid()'),
    },
    client_enrollment_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'client_enrollments',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
    client_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'clients',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
    meal_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('now()'),
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    approx_calories: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    has_photo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    photo_ref: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'filled',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('now()'),
    },
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE nutrition_diaries
      ADD CONSTRAINT nutrition_diaries_status_valid
        CHECK (status IN ('filled', 'pending', 'needs_clarification')),
      ADD CONSTRAINT nutrition_diaries_approx_calories_non_negative
        CHECK (approx_calories IS NULL OR approx_calories >= 0);
  `);

  await queryInterface.addIndex('nutrition_diaries', ['client_enrollment_id'], {
    name: 'nutrition_diaries_client_enrollment_id_idx',
  });

  await queryInterface.addIndex('nutrition_diaries', ['client_id'], {
    name: 'nutrition_diaries_client_id_idx',
  });

  await queryInterface.addIndex('nutrition_diaries', ['status'], {
    name: 'nutrition_diaries_status_idx',
  });

  await queryInterface.addIndex('nutrition_diaries', ['meal_at'], {
    name: 'nutrition_diaries_meal_at_idx',
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('nutrition_diaries');
};
