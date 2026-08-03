// Добавление типа сообщения inactivity_warning для предупреждения о неактивности (roadmap 6.3, ФТ-9).

import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query(`
    ALTER TABLE messages
      DROP CONSTRAINT messages_type_valid,
      ADD CONSTRAINT messages_type_valid
        CHECK (type IN ('recommendation', 'reminder', 'questionnaire_reminder', 'evening_reminder', 'inactivity_warning', 'report', 'info'));
  `);
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query(`
    ALTER TABLE messages
      DROP CONSTRAINT messages_type_valid,
      ADD CONSTRAINT messages_type_valid
        CHECK (type IN ('recommendation', 'reminder', 'questionnaire_reminder', 'evening_reminder', 'report', 'info'));
  `);
};
