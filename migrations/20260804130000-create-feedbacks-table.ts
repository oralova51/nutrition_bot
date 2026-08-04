// Таблица feedbacks — оценки рекомендаций и итоговые оценки курса.
// См. SA/ERD.md §2 FEEDBACK, ФТ-15, ФТ-16, ФТ-17, roadmap 7.10.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('feedbacks', {
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
    recommendation_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'recommendations',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    is_applied: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    source: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'recommendation',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('now()'),
    },
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE feedbacks
      ADD CONSTRAINT feedbacks_rating_valid
        CHECK (rating BETWEEN 1 AND 5),
      ADD CONSTRAINT feedbacks_source_valid
        CHECK (source IN ('course_final', 'recommendation'));
  `);

  await queryInterface.addIndex('feedbacks', ['client_id'], {
    name: 'feedbacks_client_id_idx',
  });
  await queryInterface.addIndex('feedbacks', ['recommendation_id'], {
    name: 'feedbacks_recommendation_id_idx',
  });
  await queryInterface.addIndex('feedbacks', ['source'], {
    name: 'feedbacks_source_idx',
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('feedbacks');
};
