// Таблица recommendations — персональные рекомендации клиенту.
// См. SA/ERD.md §2 RECOMMENDATION, ФТ-6, ФТ-7, roadmap 5.5.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('recommendations', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: queryInterface.sequelize.literal('gen_random_uuid()'),
    },
    client_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'clients',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    nutrition_diary_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'nutrition_diaries',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    questionnaire_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'questionnaires',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    type: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    priority: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'sent',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('now()'),
    },
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE recommendations
      ADD CONSTRAINT recommendations_type_valid
        CHECK (type IN ('product', 'habit', 'regimen', 'calories')),
      ADD CONSTRAINT recommendations_priority_valid
        CHECK (priority IN ('critical', 'high', 'medium', 'low')),
      ADD CONSTRAINT recommendations_status_valid
        CHECK (status IN ('sent', 'read', 'applied', 'dismissed')),
      ADD CONSTRAINT recommendations_one_source_check
        CHECK (num_nonnulls(nutrition_diary_id, questionnaire_id) = 1);
  `);

  await queryInterface.addIndex('recommendations', ['client_id', 'created_at'], {
    name: 'recommendations_client_id_created_at_idx',
  });
  await queryInterface.addIndex('recommendations', ['nutrition_diary_id'], {
    name: 'recommendations_nutrition_diary_id_idx',
  });
  await queryInterface.addIndex('recommendations', ['questionnaire_id'], {
    name: 'recommendations_questionnaire_id_idx',
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('recommendations');
};
