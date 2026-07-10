// Модель Questionnaire — анкета онбординга клиента.
// Поля и ограничения: SA/ERD.md §2 QUESTIONNAIRE, SA/anketa.md.

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export const QUESTIONNAIRE_STATUSES = ['in_progress', 'completed'] as const;

export type QuestionnaireStatus = (typeof QUESTIONNAIRE_STATUSES)[number];

export class Questionnaire extends Model<
  InferAttributes<Questionnaire>,
  InferCreationAttributes<Questionnaire>
> {
  declare id: CreationOptional<string>;
  declare clientEnrollmentId: string;
  declare clientId: string;
  declare answers: CreationOptional<Record<string, unknown>>;
  declare currentQuestion: CreationOptional<number>;
  declare status: CreationOptional<QuestionnaireStatus>;
  declare lastAnswerAt: Date | null;
  declare lastReminderAt: Date | null;
  declare completedAt: Date | null;
  declare analysisResult: Record<string, unknown> | null;
}

export function initQuestionnaireModel(sequelize: Sequelize): typeof Questionnaire {
  Questionnaire.init(
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
      answers: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      currentQuestion: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'in_progress',
      },
      lastAnswerAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastReminderAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      analysisResult: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: 'questionnaires',
      underscored: true,
      timestamps: false,
    },
  );

  return Questionnaire;
}
