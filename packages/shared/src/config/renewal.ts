// Конфигурация предложения продления курса (roadmap 8.2).
// Читается из переменных окружения и используется в bot, scheduler и api.

export interface RenewalConfig {
  /** Ссылка на оформление продления в системе студии. */
  checkoutUrl: string;
  /** Базовая цена курса в копейках (например, 1 000 000 = 10 000 ₽). */
  basePrice: number;
  /** Размер скидки на продление в процентах (0–100). */
  discountPercent: number;
}

export function resolveRenewalConfig(): RenewalConfig {
  const checkoutUrl = process.env.RENEWAL_CHECKOUT_URL;
  if (!checkoutUrl) {
    throw new Error(
      'RENEWAL_CHECKOUT_URL не задан. Укажите переменную окружения (см. .env.example).',
    );
  }

  const basePriceRaw = process.env.RENEWAL_BASE_PRICE;
  if (!basePriceRaw) {
    throw new Error(
      'RENEWAL_BASE_PRICE не задан. Укажите переменную окружения (см. .env.example).',
    );
  }

  const basePrice = Number(basePriceRaw);
  if (!Number.isInteger(basePrice) || basePrice <= 0) {
    throw new Error(
      `RENEWAL_BASE_PRICE должен быть целым положительным числом (копейки), получено: "${basePriceRaw}"`,
    );
  }

  const discountPercentRaw = process.env.RENEWAL_DISCOUNT_PERCENT ?? '15';
  const discountPercent = Number(discountPercentRaw);
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new Error(
      `RENEWAL_DISCOUNT_PERCENT должен быть целым числом 0–100, получено: "${discountPercentRaw}"`,
    );
  }

  return { checkoutUrl, basePrice, discountPercent };
}

/** Форматирует сумму в копейках для отображения в рублях. */
export function formatKopecks(amountKopecks: number): string {
  return (amountKopecks / 100)
    .toLocaleString('ru-RU', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
    .replace(/\u00A0|\u202F/g, ' ');
}

export function calculateFinalPriceKopecks(basePrice: number, discountPercent: number): number {
  return Math.round(basePrice * (1 - discountPercent / 100));
}
