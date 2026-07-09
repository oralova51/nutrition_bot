// Таблица courses — программа питания студии, см. SA/ERD.md §2 COURSE.
// end_date хранится явно (вычисляется при создании: start_date + duration_days).

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('courses', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: queryInterface.sequelize.literal('gen_random_uuid()'),
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    duration_days: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE courses
      ADD CONSTRAINT courses_duration_days_positive CHECK (duration_days > 0),
      ADD CONSTRAINT courses_end_date_after_start CHECK (end_date >= start_date);
  `);
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('courses');
};
