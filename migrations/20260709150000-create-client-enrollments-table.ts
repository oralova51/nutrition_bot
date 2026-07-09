// Таблица client_enrollments — запись клиента о прохождении курса.
// См. SA/ERD.md §2 CLIENT_ENROLLMENT, Domain_Analysis_v2.md §2, adminAPI.md §4.3.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('client_enrollments', {
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
      onDelete: 'RESTRICT',
    },
    course_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'courses',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active',
    },
    onboarding_status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'pending',
    },
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE client_enrollments
      ADD CONSTRAINT client_enrollments_end_date_after_start CHECK (end_date >= start_date),
      ADD CONSTRAINT client_enrollments_status_valid
        CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
      ADD CONSTRAINT client_enrollments_onboarding_status_valid
        CHECK (onboarding_status IN ('pending', 'in_progress', 'settings_pending', 'completed'));
  `);

  await queryInterface.addIndex('client_enrollments', ['client_id'], {
    name: 'client_enrollments_client_id_idx',
  });

  await queryInterface.addIndex('client_enrollments', ['course_id'], {
    name: 'client_enrollments_course_id_idx',
  });

  await queryInterface.addIndex('client_enrollments', ['status'], {
    name: 'client_enrollments_status_idx',
  });

  await queryInterface.addIndex('client_enrollments', ['end_date'], {
    name: 'client_enrollments_end_date_idx',
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('client_enrollments');
};
