// Таблица reports — итоговые и промежуточные отчёты о питании за период.
// См. SA/ERD.md §2 REPORT, ФТ-14, roadmap 7.3.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('reports', {
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
    period_start: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    period_end: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    diary_stats: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    adherence_percent: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    problem_areas: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    dynamics: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    ai_summary: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('now()'),
    },
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE reports
      ADD CONSTRAINT reports_type_valid
        CHECK (type IN ('weekly', 'monthly', 'final')),
      ADD CONSTRAINT reports_adherence_percent_range
        CHECK (adherence_percent IS NULL OR (adherence_percent >= 0 AND adherence_percent <= 100)),
      ADD CONSTRAINT reports_final_one_per_enrollment
        UNIQUE (client_enrollment_id, type)
        WHERE type = 'final';
  `);

  await queryInterface.addIndex('reports', ['client_enrollment_id'], {
    name: 'reports_client_enrollment_id_idx',
  });
  await queryInterface.addIndex('reports', ['client_id'], {
    name: 'reports_client_id_idx',
  });
  await queryInterface.addIndex('reports', ['type'], {
    name: 'reports_type_idx',
  });
  await queryInterface.addIndex('reports', ['period_start', 'period_end'], {
    name: 'reports_period_idx',
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('reports');
};
