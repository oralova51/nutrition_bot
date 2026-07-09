// Таблица enrollment_links — ссылки-приглашения для подключения клиентов к боту.
// См. SA/adminAPI.md §2–3, Domain_Analysis_v2.md, ФТ-1.
// Правило 9 (SA_SUMMARY §4): не более одной активной ссылки на enrollment —
// partial unique index по enrollment_id WHERE status = 'active'.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('enrollment_links', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: queryInterface.sequelize.literal('gen_random_uuid()'),
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
    code: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    used_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    used_by_telegram_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('NOW()'),
    },
    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE enrollment_links
      ADD CONSTRAINT enrollment_links_status_valid
        CHECK (status IN ('active', 'used', 'expired', 'revoked')),
      ADD CONSTRAINT enrollment_links_used_at_consistency
        CHECK ((status = 'used') = (used_at IS NOT NULL));
  `);

  await queryInterface.addIndex('enrollment_links', ['enrollment_id'], {
    name: 'enrollment_links_enrollment_id_idx',
  });

  await queryInterface.addIndex('enrollment_links', ['enrollment_id'], {
    name: 'enrollment_links_one_active_per_enrollment',
    unique: true,
    where: { status: 'active' },
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('enrollment_links');
};
