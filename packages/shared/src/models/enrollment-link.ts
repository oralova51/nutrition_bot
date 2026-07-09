// Модель EnrollmentLink — ссылка-приглашение для подключения клиента к боту.
// Поля и ограничения: SA/adminAPI.md §2–3, ФТ-1, SA_SUMMARY §4 (правила 8, 9).

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export const ENROLLMENT_LINK_STATUSES = ['active', 'used', 'expired', 'revoked'] as const;

export type EnrollmentLinkStatus = (typeof ENROLLMENT_LINK_STATUSES)[number];

export class EnrollmentLink extends Model<
  InferAttributes<EnrollmentLink>,
  InferCreationAttributes<EnrollmentLink>
> {
  declare id: CreationOptional<string>;
  declare enrollmentId: string;
  /** Код без префикса `enr_` (adminAPI.md §3) — префикс добавляется только в deep link URL. */
  declare code: string;
  declare expiresAt: Date;
  declare usedAt: Date | null;
  /** BIGINT в PostgreSQL; Sequelize отдаёт строку, чтобы не терять точность. */
  declare usedByTelegramId: string | null;
  declare status: CreationOptional<EnrollmentLinkStatus>;
  declare createdAt: CreationOptional<Date>;
  declare revokedAt: Date | null;
}

export function initEnrollmentLinkModel(sequelize: Sequelize): typeof EnrollmentLink {
  EnrollmentLink.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      enrollmentId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(32),
        allowNull: false,
        unique: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      usedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      usedByTelegramId: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'active',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: 'enrollment_links',
      underscored: true,
      timestamps: true,
      updatedAt: false,
      createdAt: 'createdAt',
    },
  );

  return EnrollmentLink;
}
