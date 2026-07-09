// Таблица messages — факт доставки сообщения клиенту.
// См. SA/ERD.md §2 MESSAGE, Domain_Analysis_v2.md §2, nonFR.md §5.
// recommendation_id — nullable UUID без FK: таблица recommendations появится на этапе 5.

import { DataTypes } from 'sequelize';
import type { Migration } from '../scripts/migrate.js';

export const up: Migration = async ({ context: queryInterface }) => {
  await queryInterface.createTable('messages', {
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
    recommendation_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    type: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    channel: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'telegram',
    },
    delivery_status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'sent',
    },
    retry_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: queryInterface.sequelize.literal('NOW()'),
    },
  });

  await queryInterface.sequelize.query(`
    ALTER TABLE messages
      ADD CONSTRAINT messages_type_valid
        CHECK (type IN ('recommendation', 'reminder', 'questionnaire_reminder', 'report', 'info')),
      ADD CONSTRAINT messages_category_valid
        CHECK (category IN ('transactional', 'optional')),
      ADD CONSTRAINT messages_channel_valid
        CHECK (channel IN ('telegram', 'whatsapp', 'max')),
      ADD CONSTRAINT messages_delivery_status_valid
        CHECK (delivery_status IN ('sent', 'delivered', 'read', 'delivery_failed')),
      ADD CONSTRAINT messages_retry_count_range
        CHECK (retry_count >= 0 AND retry_count <= 3);
  `);

  await queryInterface.addIndex('messages', ['client_id'], {
    name: 'messages_client_id_idx',
  });

  await queryInterface.addIndex('messages', ['delivery_status'], {
    name: 'messages_delivery_status_idx',
  });

  await queryInterface.addIndex('messages', ['created_at'], {
    name: 'messages_created_at_idx',
  });

  await queryInterface.addIndex('messages', ['recommendation_id'], {
    name: 'messages_recommendation_id_idx',
  });
};

export const down: Migration = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('messages');
};
