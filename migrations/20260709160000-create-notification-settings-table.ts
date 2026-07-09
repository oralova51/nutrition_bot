// Таблица notification_settings — настройки уведомлений клиента (1:1 к clients).
// См. SA/ERD.md §2 NOTIFICATION_SETTINGS, Domain §6 правило 3 и 7.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('notification_settings', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: queryInterface.sequelize.literal('gen_random_uuid()'),
    },
    client_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: {
        model: 'clients',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
    reminder_time: {
      type: DataTypes.STRING(5),
      allowNull: false,
      defaultValue: '09:00',
    },
    frequency: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'daily',
    },
    enabled_types: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: ['diary', 'recommendations', 'weekly_report'],
    },
    timezone: {
      type: DataTypes.STRING(64),
      allowNull: false,
      defaultValue: 'Europe/Moscow',
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    disabled_reason: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE notification_settings
      ADD CONSTRAINT notification_settings_reminder_time_format
        CHECK (reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
      ADD CONSTRAINT notification_settings_frequency_valid
        CHECK (frequency IN ('daily', 'every_other_day', 'three_per_week', 'custom_days')),
      ADD CONSTRAINT notification_settings_disabled_reason_valid
        CHECK (disabled_reason IS NULL OR disabled_reason IN ('user_request', 'inactivity')),
      ADD CONSTRAINT notification_settings_disabled_reason_only_when_off
        CHECK (enabled = false OR disabled_reason IS NULL);
  `);
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('notification_settings');
};
