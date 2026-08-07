// Модель RenewalOffer — предложение продлить курс (roadmap 8.1–8.3, ФТ-18).
// Хранит факт отправки предложения и нажатия кнопки «Продлить курс» для статистики администратора.

import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export const RENEWAL_OFFER_STATUSES = ['sent', 'clicked', 'converted', 'dismissed'] as const;

export type RenewalOfferStatus = (typeof RENEWAL_OFFER_STATUSES)[number];

export class RenewalOffer extends Model<
  InferAttributes<RenewalOffer>,
  InferCreationAttributes<RenewalOffer>
> {
  declare id: CreationOptional<string>;
  declare clientId: string;
  declare enrollmentId: string;
  declare status: CreationOptional<RenewalOfferStatus>;
  declare checkoutUrl: string;
  /** Базовая цена в копейках. */
  declare basePrice: number;
  declare discountPercent: number;
  /** Итоговая цена со скидкой в копейках. */
  declare finalPrice: number;
  declare offeredAt: CreationOptional<Date>;
  declare clickedAt: Date | null;
}

export function initRenewalOfferModel(sequelize: Sequelize): typeof RenewalOffer {
  RenewalOffer.init(
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
      enrollmentId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'sent',
      },
      checkoutUrl: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      basePrice: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      discountPercent: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      finalPrice: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      offeredAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      clickedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: 'renewal_offers',
      underscored: true,
      timestamps: true,
      updatedAt: false,
      createdAt: 'offeredAt',
    },
  );

  return RenewalOffer;
}
