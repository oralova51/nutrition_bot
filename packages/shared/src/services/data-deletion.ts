// Удаление всех персональных данных клиента (GDPR / 152-ФЗ).
// Используется и админ-эндпоинтом, и job'ом политики хранения.

import { Op, type Transaction } from 'sequelize';
import { Client } from '../models/client.js';
import { ClientEnrollment } from '../models/client-enrollment.js';
import { EnrollmentLink } from '../models/enrollment-link.js';
import { EnrollmentLinkAttempt } from '../models/enrollment-link-attempt.js';
import { Feedback } from '../models/feedback.js';
import { Message } from '../models/message.js';
import { NotificationSettings } from '../models/notification-settings.js';
import { NutritionDiary } from '../models/nutrition-diary.js';
import { Questionnaire } from '../models/questionnaire.js';
import { Recommendation } from '../models/recommendation.js';
import { RenewalOffer } from '../models/renewal-offer.js';
import { Report } from '../models/report.js';

/**
 * Полностью удаляет клиента и все связанные данные.
 * Удаление выполняется в переданной транзакции; если транзакция не передана,
 * создаётся новая.
 */
export async function deleteClientData(clientId: string, transaction?: Transaction): Promise<void> {
  const runInTransaction = async (t: Transaction): Promise<void> => {
    const enrollments = await ClientEnrollment.findAll({
      where: { clientId },
      attributes: ['id'],
      transaction: t,
    });
    const enrollmentIds = enrollments.map((e) => e.id);

    // Удаляем записи, привязанные к enrollment'ам.
    await NutritionDiary.destroy({ where: { clientId }, transaction: t });
    await Questionnaire.destroy({ where: { clientId }, transaction: t });
    await Report.destroy({ where: { clientId }, transaction: t });
    await RenewalOffer.destroy({ where: { clientId }, transaction: t });

    // Recommendations и Feedback ссылаются на дневники/анкеты/рекомендации,
    // удаляем их до родительских сущностей.
    await Recommendation.destroy({ where: { clientId }, transaction: t });
    await Feedback.destroy({ where: { clientId }, transaction: t });
    await Message.destroy({ where: { clientId }, transaction: t });

    if (enrollmentIds.length > 0) {
      const links = await EnrollmentLink.findAll({
        where: { enrollmentId: { [Op.in]: enrollmentIds } },
        attributes: ['id'],
        transaction: t,
      });
      const linkIds = links.map((link) => link.id);

      if (linkIds.length > 0) {
        await EnrollmentLinkAttempt.destroy({
          where: { linkId: { [Op.in]: linkIds } },
          transaction: t,
        });
      }

      await EnrollmentLink.destroy({
        where: { enrollmentId: { [Op.in]: enrollmentIds } },
        transaction: t,
      });
      await ClientEnrollment.destroy({
        where: { id: { [Op.in]: enrollmentIds } },
        transaction: t,
      });
    }

    await NotificationSettings.destroy({ where: { clientId }, transaction: t });
    await Client.destroy({ where: { id: clientId }, transaction: t });
  };

  if (transaction) {
    await runInTransaction(transaction);
    return;
  }

  const sequelize = Client.sequelize;
  if (!sequelize) {
    throw new Error('Sequelize не инициализирован');
  }
  await sequelize.transaction(runInTransaction);
}
