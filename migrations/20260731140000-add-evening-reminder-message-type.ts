// Добавление типа сообщения evening_reminder для вечерних напоминаний (roadmap 4.16).

import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query(`
    ALTER TABLE messages
      DROP CONSTRAINT messages_type_valid,
      ADD CONSTRAINT messages_type_valid
        CHECK (type IN ('recommendation', 'reminder', 'questionnaire_reminder', 'evening_reminder', 'report', 'info'));
  `);
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query(`
    ALTER TABLE messages
      DROP CONSTRAINT messages_type_valid,
      ADD CONSTRAINT messages_type_valid
        CHECK (type IN ('recommendation', 'reminder', 'questionnaire_reminder', 'report', 'info'));
  `);
};
