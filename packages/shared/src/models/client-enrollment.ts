// Модель ClientEnrollment — запись клиента о прохождении курса.
// Поля и ограничения: SA/ERD.md §2 CLIENT_ENROLLMENT, adminAPI.md §4.3.

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export const CLIENT_ENROLLMENT_STATUSES = [
  'active',
  'paused',
  'completed',
  'cancelled',
] as const;

export type ClientEnrollmentStatus = (typeof CLIENT_ENROLLMENT_STATUSES)[number];

export const ONBOARDING_STATUSES = [
  'pending',
  'in_progress',
  'settings_pending',
  'completed',
] as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export class ClientEnrollment extends Model<
  InferAttributes<ClientEnrollment>,
  InferCreationAttributes<ClientEnrollment>
> {
  declare id: CreationOptional<string>;
  declare clientId: string;
  declare courseId: string;
  declare startDate: string;
  declare endDate: string;
  declare status: CreationOptional<ClientEnrollmentStatus>;
  declare onboardingStatus: CreationOptional<OnboardingStatus>;
}

export function initClientEnrollmentModel(sequelize: Sequelize): typeof ClientEnrollment {
  ClientEnrollment.init(
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
      courseId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      endDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'active',
      },
      onboardingStatus: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'pending',
      },
    },
    {
      sequelize,
      tableName: 'client_enrollments',
      underscored: true,
      timestamps: false,
    },
  );

  return ClientEnrollment;
}
