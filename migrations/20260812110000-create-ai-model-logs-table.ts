// Таблица ai_model_logs — журнал обновлений AI-модели/промптов (roadmap 11.5).
// См. SA/SA_SUMMARY.md §3.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('ai_model_logs', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: queryInterface.sequelize.literal('gen_random_uuid()'),
    },
    version: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    update_reason: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    analyst_comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('now()'),
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('now()'),
    },
  });

  await queryInterface.addIndex('ai_model_logs', ['version'], {
    name: 'ai_model_logs_version_idx',
  });

  await queryInterface.addIndex('ai_model_logs', ['created_at'], {
    name: 'ai_model_logs_created_at_idx',
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('ai_model_logs');
};
