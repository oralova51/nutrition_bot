// Модель EnrollmentLinkAttempt — лог попыток использования ссылки-приглашения (ФТ-1).
// Поля и ограничения: SA/adminAPI.md §3.
// linkId допускает null: если код в payload синтаксически невалиден или не найден
// в БД, попытку всё равно нужно залогировать (ФТ-1: «логирует все попытки, успешные
// и неудачные»), но привязать её к конкретной несуществующей ссылке невозможно.

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export const ENROLLMENT_LINK_ATTEMPT_RESULTS = [
  'success',
  'expired',
  'already_used',
  'invalid_code',
  'enrollment_cancelled',
] as const;

export type EnrollmentLinkAttemptResult = (typeof ENROLLMENT_LINK_ATTEMPT_RESULTS)[number];

export class EnrollmentLinkAttempt extends Model<
  InferAttributes<EnrollmentLinkAttempt>,
  InferCreationAttributes<EnrollmentLinkAttempt>
> {
  declare id: CreationOptional<string>;
  declare linkId: string | null;
  declare attemptedAt: CreationOptional<Date>;
  /** BIGINT в PostgreSQL; Sequelize отдаёт строку, чтобы не терять точность. */
  declare telegramId: string | null;
  declare result: EnrollmentLinkAttemptResult;
}

export function initEnrollmentLinkAttemptModel(sequelize: Sequelize): typeof EnrollmentLinkAttempt {
  EnrollmentLinkAttempt.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      linkId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      attemptedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      telegramId: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      result: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
    },
    {
      sequelize,
      tableName: 'enrollment_link_attempts',
      underscored: true,
      timestamps: false,
    },
  );

  return EnrollmentLinkAttempt;
}
