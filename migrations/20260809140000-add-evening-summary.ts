// ФТ-24: Message.type evening_summary, Report.type daily, NotificationType evening_summary.

import type { Migration } from '../scripts/migrate.js';

const MESSAGE_TYPES_WITH_SUMMARY =
  "('recommendation', 'reminder', 'questionnaire_reminder', 'evening_reminder', 'evening_summary', 'inactivity_warning', 'report', 'feedback_request', 'feedback', 'info', 'renewal_offer')";

const MESSAGE_TYPES_WITHOUT_SUMMARY =
  "('recommendation', 'reminder', 'questionnaire_reminder', 'evening_reminder', 'inactivity_warning', 'report', 'feedback_request', 'feedback', 'info', 'renewal_offer')";

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query(`
    ALTER TABLE messages
      DROP CONSTRAINT messages_type_valid,
      ADD CONSTRAINT messages_type_valid
        CHECK (type IN ${MESSAGE_TYPES_WITH_SUMMARY});
  `);

  await queryInterface.sequelize.query(`
    ALTER TABLE reports
      DROP CONSTRAINT reports_type_valid,
      ADD CONSTRAINT reports_type_valid
        CHECK (type IN ('daily', 'weekly', 'monthly', 'final'));
  `);

  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS reports_daily_one_per_enrollment_day
      ON reports (client_enrollment_id, period_start)
      WHERE type = 'daily';
  `);

  // Бэкфилл: добавить evening_summary в enabledTypes, если его ещё нет.
  await queryInterface.sequelize.query(`
    UPDATE notification_settings
    SET enabled_types = enabled_types || '["evening_summary"]'::jsonb
    WHERE NOT (enabled_types ? 'evening_summary');
  `);

  await queryInterface.sequelize.query(`
    ALTER TABLE notification_settings
      ALTER COLUMN enabled_types
      SET DEFAULT '["diary", "recommendations", "weekly_report", "evening_summary"]'::jsonb;
  `);
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query(`
    ALTER TABLE notification_settings
      ALTER COLUMN enabled_types
      SET DEFAULT '["diary", "recommendations", "weekly_report"]'::jsonb;
  `);

  await queryInterface.sequelize.query(`
    UPDATE notification_settings
    SET enabled_types = enabled_types - 'evening_summary';
  `);

  await queryInterface.sequelize.query(`
    DROP INDEX IF EXISTS reports_daily_one_per_enrollment_day;
  `);

  await queryInterface.sequelize.query(`
    DELETE FROM reports WHERE type = 'daily';
  `);

  await queryInterface.sequelize.query(`
    ALTER TABLE reports
      DROP CONSTRAINT reports_type_valid,
      ADD CONSTRAINT reports_type_valid
        CHECK (type IN ('weekly', 'monthly', 'final'));
  `);

  await queryInterface.sequelize.query(`
    DELETE FROM messages WHERE type = 'evening_summary';
  `);

  await queryInterface.sequelize.query(`
    ALTER TABLE messages
      DROP CONSTRAINT messages_type_valid,
      ADD CONSTRAINT messages_type_valid
        CHECK (type IN ${MESSAGE_TYPES_WITHOUT_SUMMARY});
  `);
};
