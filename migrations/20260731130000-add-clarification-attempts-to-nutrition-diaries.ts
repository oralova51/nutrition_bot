// Добавление поля clarification_attempts в nutrition_diaries (roadmap 4.15).
// Счётчик попыток уточнения неполной информации о приёме питания.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.addColumn('nutrition_diaries', 'clarification_attempts', {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE nutrition_diaries
      ADD CONSTRAINT nutrition_diaries_clarification_attempts_non_negative
        CHECK (clarification_attempts >= 0);
  `);
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.removeColumn('nutrition_diaries', 'clarification_attempts');
};
