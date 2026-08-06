// Таблица renewal_offers — предложение продлить курс (roadmap 8.1–8.3, ФТ-18).
// Хранит факт отправки предложения и нажатия кнопки «Продлить курс» для статистики администратора.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('renewal_offers', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: queryInterface.sequelize.literal('gen_random_uuid()'),
    },
    client_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'clients',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
    enrollment_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'client_enrollments',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'sent',
    },
    checkout_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    base_price: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    discount_percent: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    final_price: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    offered_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('now()'),
    },
    clicked_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('now()'),
    },
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE renewal_offers
      ADD CONSTRAINT renewal_offers_status_valid
        CHECK (status IN ('sent', 'clicked', 'converted', 'dismissed'));
  `);

  await queryInterface.addIndex('renewal_offers', ['client_id'], {
    name: 'renewal_offers_client_id_idx',
  });
  await queryInterface.addIndex('renewal_offers', ['enrollment_id'], {
    name: 'renewal_offers_enrollment_id_idx',
  });
  await queryInterface.addIndex('renewal_offers', ['status'], {
    name: 'renewal_offers_status_idx',
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('renewal_offers');
};
