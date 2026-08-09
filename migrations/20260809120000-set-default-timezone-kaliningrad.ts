// MVP: все клиенты студии в Калининграде — фиксируем Europe/Kaliningrad
// вместо Europe/Moscow и убираем ручной выбор пояса в боте.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

const KALININGRAD = 'Europe/Kaliningrad';
const MOSCOW = 'Europe/Moscow';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query(
    `UPDATE notification_settings SET timezone = :timezone`,
    { replacements: { timezone: KALININGRAD } },
  );

  await queryInterface.changeColumn('notification_settings', 'timezone', {
    type: DataTypes.STRING(64),
    allowNull: false,
    defaultValue: KALININGRAD,
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.changeColumn('notification_settings', 'timezone', {
    type: DataTypes.STRING(64),
    allowNull: false,
    defaultValue: MOSCOW,
  });

  await queryInterface.sequelize.query(
    `UPDATE notification_settings SET timezone = :timezone`,
    { replacements: { timezone: MOSCOW } },
  );
};
