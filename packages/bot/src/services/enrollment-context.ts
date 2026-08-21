// Выбор enrollment для диалога с клиентом и закрытие дублей онбординга.
// Нельзя брать «последний по startDate»: новый pending/in_progress от повторной
// ссылки перехватывает уже пройденную анкету и превращает дневник в «вопрос 2».

import { ClientEnrollment, Questionnaire } from '@nutrition-bot/shared';
import { Op } from 'sequelize';

const LIVE_STATUSES = ['active', 'paused'] as const;

/**
 * Приоритет для живого диалога: закончить настройки → дневник (уже пройденный
 * онбординг) → продолжить анкету → только потом неначатый pending.
 * Completed выше in_progress, чтобы вторая ссылка не перехватывала дневник.
 */
export async function findEnrollmentForClient(clientId: string): Promise<ClientEnrollment | null> {
  const live = await ClientEnrollment.findAll({
    where: {
      clientId,
      status: { [Op.in]: [...LIVE_STATUSES] },
    },
  });

  const settingsPending = latestByStartDate(
    live.filter((item) => item.onboardingStatus === 'settings_pending'),
  );
  if (settingsPending) return settingsPending;

  const completed = latestByStartDate(live.filter((item) => item.onboardingStatus === 'completed'));
  if (completed) return completed;

  const inProgress = live.filter((item) => item.onboardingStatus === 'in_progress');
  if (inProgress.length === 1) return inProgress[0] ?? null;
  if (inProgress.length > 1) return pickFurthestQuestionnaire(inProgress);

  const pending = latestByStartDate(live.filter((item) => item.onboardingStatus === 'pending'));
  if (pending) return pending;

  return ClientEnrollment.findOne({
    where: {
      clientId,
      status: 'completed',
    },
    order: [['startDate', 'DESC']],
  });
}

/**
 * После успешного онбординга отменяет параллельные незавершённые enrollment'ы
 * того же клиента (вторая ссылка / гонка нескольких `/start`).
 */
export async function closeDuplicateOnboardings(
  clientId: string,
  keptEnrollmentId: string,
): Promise<void> {
  const siblings = await ClientEnrollment.findAll({
    where: {
      clientId,
      id: { [Op.ne]: keptEnrollmentId },
      status: { [Op.in]: [...LIVE_STATUSES] },
      onboardingStatus: { [Op.in]: ['pending', 'in_progress', 'settings_pending'] },
    },
  });

  for (const sibling of siblings) {
    await sibling.update({ status: 'cancelled' });
  }
}

function latestByStartDate(enrollments: ClientEnrollment[]): ClientEnrollment | null {
  if (enrollments.length === 0) return null;
  return (
    [...enrollments].sort((left, right) => right.startDate.localeCompare(left.startDate))[0] ?? null
  );
}

async function pickFurthestQuestionnaire(
  enrollments: ClientEnrollment[],
): Promise<ClientEnrollment> {
  const questionnaires = await Questionnaire.findAll({
    where: {
      clientEnrollmentId: { [Op.in]: enrollments.map((item) => item.id) },
      status: 'in_progress',
    },
  });
  const byEnrollment = new Map(
    questionnaires.map((item) => [item.clientEnrollmentId, item] as const),
  );

  const ranked = [...enrollments].sort((left, right) => {
    const progressLeft = byEnrollment.get(left.id)?.currentQuestion ?? -1;
    const progressRight = byEnrollment.get(right.id)?.currentQuestion ?? -1;
    if (progressLeft !== progressRight) return progressRight - progressLeft;
    return right.startDate.localeCompare(left.startDate);
  });

  const picked = ranked[0];
  if (picked) return picked;

  throw new Error('pickFurthestQuestionnaire: пустой список enrollment');
}
