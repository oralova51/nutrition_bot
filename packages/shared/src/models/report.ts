// Модель Report — итоговый/промежуточный отчёт о питании за период.
// Поля и ограничения: SA/ERD.md §2 REPORT, ФТ-14, ФТ-23.
// Ключевое решение: owning-связь через ClientEnrollment (roadmap 0.4).

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export const REPORT_TYPES = ['daily', 'weekly', 'monthly', 'final'] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export interface DiaryStats {
  avgCalories?: number | null;
  avgProtein?: number | null;
  avgFat?: number | null;
  avgCarbs?: number | null;
  totalDays?: number;
  totalRecords?: number;
  filledEntries?: number;
  pendingEntries?: number;
  mealsByHour?: Record<number, number>;
  topProducts?: string[];
  topProblems?: string[];
}

export interface ProblemArea {
  area: string;
  count: number;
}

export interface Dynamics {
  calorieTrend?: 'up' | 'down' | 'stable' | null;
  adherenceTrend?: 'up' | 'down' | 'stable' | null;
}

export class Report extends Model<InferAttributes<Report>, InferCreationAttributes<Report>> {
  declare id: CreationOptional<string>;
  declare clientEnrollmentId: string;
  declare clientId: string;
  declare periodStart: string;
  declare periodEnd: string;
  declare type: ReportType;
  declare diaryStats: CreationOptional<DiaryStats>;
  declare adherencePercent: number | null;
  declare problemAreas: CreationOptional<ProblemArea[]>;
  declare dynamics: CreationOptional<Dynamics>;
  declare aiSummary: string | null;
  declare createdAt: CreationOptional<Date>;
}

export function initReportModel(sequelize: Sequelize): typeof Report {
  Report.init(
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
      periodStart: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      periodEnd: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      diaryStats: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      adherencePercent: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      problemAreas: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      dynamics: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      aiSummary: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: 'reports',
      underscored: true,
      timestamps: true,
      updatedAt: false,
      createdAt: 'createdAt',
    },
  );

  return Report;
}
