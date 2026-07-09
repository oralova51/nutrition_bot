// Модель Client — конечный пользователь бота (Telegram).
// Поля и ограничения: SA/ERD.md §2 CLIENT, Domain_Analysis_v2.md §2.

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export class Client extends Model<InferAttributes<Client>, InferCreationAttributes<Client>> {
  declare id: CreationOptional<string>;
  declare firstName: string;
  declare lastName: string;
  /** BIGINT в PostgreSQL; Sequelize отдаёт строку, чтобы не терять точность. */
  declare telegramId: string | null;
  declare telegramUsername: string | null;
  declare email: string | null;
  declare registeredAt: CreationOptional<Date>;
  declare lastInteractionAt: Date | null;
}

export function initClientModel(sequelize: Sequelize): typeof Client {
  Client.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      firstName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      lastName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      telegramId: {
        type: DataTypes.BIGINT,
        allowNull: true,
        unique: true,
      },
      telegramUsername: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      registeredAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      lastInteractionAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: 'clients',
      underscored: true,
      timestamps: false,
    },
  );

  return Client;
}
