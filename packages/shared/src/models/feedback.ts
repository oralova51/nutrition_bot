// Модель Feedback — оценка рекомендации или итоговая оценка курса.
// Поля и ограничения: SA/ERD.md §2 FEEDBACK, ФТ-15, ФТ-16, ФТ-17.
// MVP: recommendationId nullable, чтобы можно было сохранить итоговую оценку курса.

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export class Feedback extends Model<InferAttributes<Feedback>, InferCreationAttributes<Feedback>> {
  declare id: CreationOptional<string>;
  declare clientId: string;
  declare recommendationId: string | null;
  declare rating: number;
  declare comment: string | null;
  declare isApplied: boolean | null;
  declare isResolved: CreationOptional<boolean>;
  declare source: CreationOptional<'course_final' | 'recommendation'>;
  declare createdAt: CreationOptional<Date>;
}

export function initFeedbackModel(sequelize: Sequelize): typeof Feedback {
  Feedback.init(
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
      rating: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: 1,
          max: 5,
        },
      },
      comment: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isApplied: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      isResolved: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      source: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'recommendation',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: 'feedbacks',
      underscored: true,
      timestamps: true,
      updatedAt: false,
      createdAt: 'createdAt',
    },
  );

  return Feedback;
}
