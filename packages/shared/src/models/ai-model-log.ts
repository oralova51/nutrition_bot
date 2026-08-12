// Модель AIModelLog — журнал обновлений AI-модели/промптов на основе обратной связи.
// См. SA/SA_SUMMARY.md §3, roadmap 11.5.

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export class AIModelLog extends Model<
  InferAttributes<AIModelLog>,
  InferCreationAttributes<AIModelLog>
> {
  declare id: CreationOptional<string>;
  declare version: string;
  declare updateReason: string;
  declare analystComment: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initAIModelLogModel(sequelize: Sequelize): typeof AIModelLog {
  AIModelLog.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      version: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      updateReason: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'update_reason',
      },
      analystComment: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'analyst_comment',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    {
      sequelize,
      tableName: 'ai_model_logs',
      underscored: true,
      timestamps: true,
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  );

  return AIModelLog;
}
