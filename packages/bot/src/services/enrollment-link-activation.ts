// Активация ссылки-приглашения при обработке deep link `/start` — roadmap 2.4–2.6.
// Бизнес-правила: adminAPI.md §2 (срок 7 дней, одноразовость по активации, формат кода),
// §5 (Internal API activate — коды ошибок, здесь применяются напрямую к shared-моделям,
// без похода в packages/api), SA_SUMMARY §4 правила 8–9.

import {
  Client,
  ClientEnrollment,
  EnrollmentLink,
  EnrollmentLinkAttempt,
  getSequelize,
  type EnrollmentLinkAttemptResult,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';

/** Префикс в deep link (`t.me/bot?start=enr_...`); в БД (`enrollment_links.code`) не хранится. */
export const ENROLLMENT_LINK_PAYLOAD_PREFIX = 'enr_';

/** adminAPI.md §2: код — 16 символов base64url после префикса `enr_`. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{16}$/;

export type ActivationErrorCode =
  'INVALID_CODE' | 'LINK_EXPIRED' | 'ALREADY_USED' | 'ENROLLMENT_CANCELLED';

export type ActivationResult =
  | {
      success: true;
      enrollment: ClientEnrollment;
      client: Client;
      clientId: string;
      onboardingStatus: string;
    }
  | { success: false; error: ActivationErrorCode };

export interface ActivateEnrollmentLinkParams {
  /** Текст после команды `/start` (ctx.match), включая префикс `enr_`. */
  payload: string;
  telegramId: number;
  telegramUsername: string | null;
  logger: Logger;
}

function extractCode(payload: string): string | null {
  if (!payload.startsWith(ENROLLMENT_LINK_PAYLOAD_PREFIX)) {
    return null;
  }
  const code = payload.slice(ENROLLMENT_LINK_PAYLOAD_PREFIX.length);
  return CODE_PATTERN.test(code) ? code : null;
}

async function logAttempt(
  linkId: string | null,
  telegramId: number,
  result: EnrollmentLinkAttemptResult,
): Promise<void> {
  await EnrollmentLinkAttempt.create({
    linkId,
    telegramId: telegramId.toString(),
    result,
  });
}

/**
 * Разбирает payload `/start`, проверяет ссылку и, если она валидна, привязывает
 * telegramId клиента к соответствующему ClientEnrollment (roadmap 2.4–2.5).
 * Каждая попытка (успех или ошибка бизнес-правила) логируется в EnrollmentLinkAttempt
 * (roadmap 2.6, ФТ-1: «система логирует все попытки использования ссылки»).
 *
 * Ошибки целостности данных (ссылка ссылается на удалённый enrollment/client — при
 * действующих FK-ограничениях недостижимо в норме) не логируются как попытка клиента
 * и пробрасываются вызывающему коду как исключение.
 */
export async function activateEnrollmentLink(
  params: ActivateEnrollmentLinkParams,
): Promise<ActivationResult> {
  const { payload, telegramId, telegramUsername, logger } = params;

  const code = extractCode(payload);
  if (!code) {
    await logAttempt(null, telegramId, 'invalid_code');
    return { success: false, error: 'INVALID_CODE' };
  }

  const link = await EnrollmentLink.findOne({ where: { code } });
  if (!link) {
    await logAttempt(null, telegramId, 'invalid_code');
    return { success: false, error: 'INVALID_CODE' };
  }

  if (link.status === 'used') {
    await logAttempt(link.id, telegramId, 'already_used');
    return { success: false, error: 'ALREADY_USED' };
  }

  if (link.status === 'revoked') {
    // Отозванная ссылка внешне не должна отличаться от несуществующей — не раскрываем
    // клиенту факт отзыва (например, при regenerate — see adminAPI.md §4.4).
    await logAttempt(link.id, telegramId, 'invalid_code');
    return { success: false, error: 'INVALID_CODE' };
  }

  if (link.expiresAt.getTime() < Date.now()) {
    await link.update({ status: 'expired' });
    await logAttempt(link.id, telegramId, 'expired');
    return { success: false, error: 'LINK_EXPIRED' };
  }

  const enrollment = await ClientEnrollment.findByPk(link.enrollmentId);
  if (!enrollment) {
    logger.error(
      { linkId: link.id, enrollmentId: link.enrollmentId },
      'EnrollmentLink ссылается на несуществующий ClientEnrollment — нарушение целостности данных',
    );
    throw new Error(
      `ClientEnrollment ${link.enrollmentId} не найден для EnrollmentLink ${link.id}`,
    );
  }

  if (enrollment.status === 'cancelled') {
    await logAttempt(link.id, telegramId, 'enrollment_cancelled');
    return { success: false, error: 'ENROLLMENT_CANCELLED' };
  }

  const client = await Client.findByPk(enrollment.clientId);
  if (!client) {
    logger.error(
      { linkId: link.id, clientId: enrollment.clientId },
      'ClientEnrollment ссылается на несуществующего Client — нарушение целостности данных',
    );
    throw new Error(
      `Client ${enrollment.clientId} не найден для ClientEnrollment ${enrollment.id}`,
    );
  }

  const now = new Date();

  const existingClient = await Client.findOne({
    where: { telegramId: telegramId.toString() },
  });

  await getSequelize().transaction(async (transaction) => {
    await link.update(
      { status: 'used', usedAt: now, usedByTelegramId: telegramId.toString() },
      { transaction },
    );

    if (existingClient) {
      if (existingClient.id !== client.id) {
        await enrollment.update({ clientId: existingClient.id }, { transaction });
      }
      await existingClient.update({ telegramUsername, lastInteractionAt: now }, { transaction });
    } else {
      await client.update(
        { telegramId: telegramId.toString(), telegramUsername, lastInteractionAt: now },
        { transaction },
      );
    }

    await EnrollmentLinkAttempt.create(
      { linkId: link.id, telegramId: telegramId.toString(), result: 'success' },
      { transaction },
    );
  });

  const actualClient = existingClient ?? client;
  const finalClient = await Client.findByPk(actualClient.id);
  if (!finalClient) {
    throw new Error(`Client ${actualClient.id} не найден после активации ссылки`);
  }

  const finalEnrollment = await ClientEnrollment.findByPk(enrollment.id);
  if (!finalEnrollment) {
    throw new Error(`ClientEnrollment ${enrollment.id} не найден после активации ссылки`);
  }

  return {
    success: true,
    enrollment: finalEnrollment,
    client: finalClient,
    clientId: finalClient.id,
    onboardingStatus: finalEnrollment.onboardingStatus,
  };
}
