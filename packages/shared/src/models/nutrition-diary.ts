// Модель NutritionDiary — запись о приёме питания клиента.
// Поля и ограничения: SA/ERD.md §2 NUTRITION_DIARY, ФТ-5.
// Ключевое решение: привязка к ClientEnrollment, а не к Client (roadmap 0.4).

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export const NUTRITION_DIARY_STATUSES = ['filled', 'pending', 'needs_clarification'] as const;

export type NutritionDiaryStatus = (typeof NUTRITION_DIARY_STATUSES)[number];

export class NutritionDiary extends Model<
  InferAttributes<NutritionDiary>,
  InferCreationAttributes<NutritionDiary>
> {
  declare id: CreationOptional<string>;
  declare clientEnrollmentId: string;
  declare clientId: string;
  declare mealAt: CreationOptional<Date>;
  declare description: string | null;
  declare approxCalories: number | null;
  declare hasPhoto: CreationOptional<boolean>;
  declare photoRef: string | null;
  declare status: CreationOptional<NutritionDiaryStatus>;
  declare clarificationAttempts: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
}

export function initNutritionDiaryModel(sequelize: Sequelize): typeof NutritionDiary {
  NutritionDiary.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientEnrollmentId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      mealAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      approxCalories: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      hasPhoto: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      photoRef: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'filled',
      },
      clarificationAttempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: 'nutrition_diaries',
      underscored: true,
      timestamps: true,
      updatedAt: false,
      createdAt: 'createdAt',
    },
  );

  return NutritionDiary;
}
