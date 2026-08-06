// Сервис предложения продления курса (roadmap 8.1–8.3, ФТ-18).
// Отправляет сообщение со скидкой, inline-кнопку «Продлить курс» и фиксирует факт в RenewalOffer.

import {
  Client,
  ClientEnrollment,
  RenewalOffer,
  calculateFinalPriceKopecks,
  formatKopecks,
  resolveRenewalConfig,
  sendTelegramMessageWithRetry,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';

export function buildRenewalMessage(
  basePrice: number,
  discountPercent: number,
  finalPrice: number,
): string {
  return [
    `Хотели бы продолжить работу? На продление действует специальная скидка ${discountPercent}%! 🎉`,
    '',
    'Продолжим вместе двигаться к твоей цели:',
    '• персональные рекомендации по питанию;',
    '• ежедневная поддержка и мягкая обратная связь;',
    '• итоговый отчёт и корректировка привычек.',
    '',
    `Стоимость курса: ${formatKopecks(basePrice)} ₽`,
    `Скидка на продление: −${discountPercent}%`,
    `<b>Итоговая стоимость: ${formatKopecks(finalPrice)} ₽</b>`,
    '',
    'Нажми кнопку ниже, чтобы оформить продление.',
  ].join('\n');
}

export function buildRenewalKeyboard(offerId: string): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  return {
    inline_keyboard: [[{ text: 'Продлить курс', callback_data: `renewal:accept:${offerId}` }]],
  };
}

interface EnrollmentWithClient extends ClientEnrollment {
  client?: Client;
}

export async function sendRenewalOffer(
  enrollment: ClientEnrollment,
  logger: Logger,
): Promise<void> {
  const enrollmentWithClient = enrollment as EnrollmentWithClient;
  const client = enrollmentWithClient.client;
  if (!client?.telegramId) {
    logger.info(
      { enrollmentId: enrollment.id },
      'Enrollment без привязанного telegramId, пропускаем предложение продления',
    );
    return;
  }

  const existing = await RenewalOffer.findOne({
    where: { enrollmentId: enrollment.id },
  });
  if (existing) {
    logger.info(
      { enrollmentId: enrollment.id, offerId: existing.id },
      'Предложение продления уже отправлялось',
    );
    return;
  }

  const { checkoutUrl, basePrice, discountPercent } = resolveRenewalConfig();
  const finalPrice = calculateFinalPriceKopecks(basePrice, discountPercent);

  const offer = await RenewalOffer.create({
    clientId: client.id,
    enrollmentId: enrollment.id,
    status: 'sent',
    checkoutUrl,
    basePrice,
    discountPercent,
    finalPrice,
  });

  const text = buildRenewalMessage(basePrice, discountPercent, finalPrice);
  const replyMarkup = buildRenewalKeyboard(offer.id);

  await sendTelegramMessageWithRetry({
    telegramId: client.telegramId,
    text,
    clientId: client.id,
    type: 'renewal_offer',
    category: 'transactional',
    parseMode: 'HTML',
    replyMarkup,
  });

  logger.info(
    { enrollmentId: enrollment.id, offerId: offer.id, clientId: client.id },
    'Предложение продления отправлено',
  );
}
