// Модель Recommendation — персональная рекомендация клиенту.
// Поля и ограничения: SA/ERD.md §2 RECOMMENDATION, ФТ-6, ФТ-7.
// Ключевое решение: ровно один из FK (nutritionDiaryId / questionnaireId) заполнен.

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export const RECOMMENDATION_TYPES = ['product', 'habit', 'regimen', 'calories'] as const;

export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const RECOMMENDATION_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

export type RecommendationPriority = (typeof RECOMMENDATION_PRIORITIES)[number];

export const RECOMMENDATION_STATUSES = ['sent', 'read', 'applied', 'dismissed'] as const;

export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export class Recommendation extends Model<
  InferAttributes<Recommendation>,
  InferCreationAttributes<Recommendation>
> {
  declare id: CreationOptional<string>;
  declare clientId: string;
  declare nutritionDiaryId: string | null;
  declare questionnaireId: string | null;
  declare type: RecommendationType;
  declare priority: RecommendationPriority;
  declare content: string | null;
  declare status: CreationOptional<RecommendationStatus>;
  declare createdAt: CreationOptional<Date>;
}

export function initRecommendationModel(sequelize: Sequelize): typeof Recommendation {
  Recommendation.init(
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
      nutritionDiaryId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      questionnaireId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      type: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      priority: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'sent',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: 'recommendations',
      underscored: true,
      timestamps: true,
      updatedAt: false,
      createdAt: 'createdAt',
    },
  );

  return Recommendation;
}
