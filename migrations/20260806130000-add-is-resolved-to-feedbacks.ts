// Добавление поля is_resolved в таблицу feedbacks для панели администратора (roadmap 9.6, SA/stage9-dashboards.md).
// Позволяет отмечать критический feedback (1–3 звезды) как обработанный.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.addColumn('feedbacks', 'is_resolved', {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });

  await queryInterface.addIndex('feedbacks', ['is_resolved'], {
    name: 'feedbacks_is_resolved_idx',
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.removeIndex('feedbacks', 'feedbacks_is_resolved_idx');
  await queryInterface.removeColumn('feedbacks', 'is_resolved');
};
