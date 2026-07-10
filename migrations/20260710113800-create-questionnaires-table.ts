// Таблица questionnaires — анкета онбординга клиента.
// См. SA/ERD.md §2 QUESTIONNAIRE, SA/anketa.md, ФТ-2.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('questionnaires', {
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
    answers: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    current_question: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'in_progress',
    },
    last_answer_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_reminder_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    analysis_result: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE questionnaires
      ADD CONSTRAINT questionnaires_status_valid
        CHECK (status IN ('in_progress', 'completed')),
      ADD CONSTRAINT questionnaires_current_question_non_negative
        CHECK (current_question >= 0),
      ADD CONSTRAINT questionnaires_completed_at_only_when_done
        CHECK ((status = 'completed') = (completed_at IS NOT NULL));
  `);

  await queryInterface.addIndex('questionnaires', ['client_enrollment_id'], {
    name: 'questionnaires_client_enrollment_id_idx',
  });

  await queryInterface.addIndex('questionnaires', ['client_id'], {
    name: 'questionnaires_client_id_idx',
  });

  await queryInterface.addIndex('questionnaires', ['status'], {
    name: 'questionnaires_status_idx',
  });

  await queryInterface.addIndex('questionnaires', ['current_question'], {
    name: 'questionnaires_current_question_idx',
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('questionnaires');
};
