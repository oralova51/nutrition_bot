// Модель NotificationSettings — настройки уведомлений клиента (1:1 к Client).
// Поля и ограничения: SA/ERD.md §2 NOTIFICATION_SETTINGS, adminAPI.md §4.3.

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export const NOTIFICATION_FREQUENCIES = [
  'daily',
  'every_other_day',
  'three_per_week',
  'custom_days',
] as const;

export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCIES)[number];

export const NOTIFICATION_TYPES = ['diary', 'recommendations', 'weekly_report'] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DISABLED_REASONS = ['user_request', 'inactivity'] as const;

export type DisabledReason = (typeof DISABLED_REASONS)[number];

export class NotificationSettings extends Model<
  InferAttributes<NotificationSettings>,
  InferCreationAttributes<NotificationSettings>
> {
  declare id: CreationOptional<string>;
  declare clientId: string;
  declare reminderTime: CreationOptional<string>;
  declare frequency: CreationOptional<NotificationFrequency>;
  declare enabledTypes: CreationOptional<NotificationType[]>;
  declare timezone: CreationOptional<string>;
  declare enabled: CreationOptional<boolean>;
  declare disabledReason: DisabledReason | null;
}

export function initNotificationSettingsModel(sequelize: Sequelize): typeof NotificationSettings {
  NotificationSettings.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
      },
      reminderTime: {
        type: DataTypes.STRING(5),
        allowNull: false,
        defaultValue: '09:00',
      },
      frequency: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'daily',
      },
      enabledTypes: {
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
      disabledReason: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: 'notification_settings',
      underscored: true,
      timestamps: false,
    },
  );

  return NotificationSettings;
}
