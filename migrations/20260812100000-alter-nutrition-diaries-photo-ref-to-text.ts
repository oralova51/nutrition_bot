// Увеличиваем размер поля photo_ref до TEXT, чтобы уместить зашифрованный
// Telegram file_id вместе с IV и auth tag (roadmap 11.1).

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.changeColumn('nutrition_diaries', 'photo_ref', {
    type: DataTypes.TEXT,
    allowNull: true,
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.changeColumn('nutrition_diaries', 'photo_ref', {
    type: DataTypes.STRING(512),
    allowNull: true,
  });
};
