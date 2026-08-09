// Модель Message — факт доставки сообщения клиенту.
// Поля и ограничения: SA/ERD.md §2 MESSAGE, ФТ-21, nonFR.md §5.

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export const MESSAGE_TYPES = [
  'recommendation',
  'reminder',
  'questionnaire_reminder',
  'evening_reminder',
  'evening_summary',
  'inactivity_warning',
  'report',
  'feedback_request',
  'feedback',
  'renewal_offer',
  'info',
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_CATEGORIES = ['transactional', 'optional'] as const;

export type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];

export const MESSAGE_CHANNELS = ['telegram', 'whatsapp', 'max'] as const;

export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const DELIVERY_STATUSES = ['sent', 'delivered', 'read', 'delivery_failed'] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export class Message extends Model<InferAttributes<Message>, InferCreationAttributes<Message>> {
  declare id: CreationOptional<string>;
  declare clientId: string;
  /** FK на recommendations — связь добавится, когда появится таблица (этап 5). */
  declare recommendationId: string | null;
  declare type: MessageType;
  declare category: MessageCategory;
  declare content: string;
  declare channel: CreationOptional<MessageChannel>;
  declare deliveryStatus: CreationOptional<DeliveryStatus>;
  declare retryCount: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
}

export function initMessageModel(sequelize: Sequelize): typeof Message {
  Message.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      recommendationId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      type: {
        type: DataTypes.STRING(30),
        allowNull: false,
      },
      category: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      channel: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'telegram',
      },
      deliveryStatus: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'sent',
      },
      retryCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          min: 0,
          max: 3,
        },
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: 'messages',
      underscored: true,
      timestamps: true,
      updatedAt: false,
      createdAt: 'createdAt',
    },
  );

  return Message;
}
