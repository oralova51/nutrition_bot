// Добавление типа сообщения renewal_offer для предложения продлить курс (roadmap 8.3, ФТ-18).

import type { Migration } from '../scripts/migrate.js';

const VALID_TYPES =
  "('recommendation', 'reminder', 'questionnaire_reminder', 'evening_reminder', 'inactivity_warning', 'report', 'feedback_request', 'feedback', 'info', 'renewal_offer')";

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query(`
    ALTER TABLE messages
      DROP CONSTRAINT messages_type_valid,
      ADD CONSTRAINT messages_type_valid
        CHECK (type IN ${VALID_TYPES});
  `);
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query(`
    ALTER TABLE messages
      DROP CONSTRAINT messages_type_valid,
      ADD CONSTRAINT messages_type_valid
        CHECK (type IN ('recommendation', 'reminder', 'questionnaire_reminder', 'evening_reminder', 'inactivity_warning', 'report', 'feedback_request', 'feedback', 'info'));
  `);
};
