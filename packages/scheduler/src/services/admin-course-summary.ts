// Короткая сводка администратору при завершении курса (этап 15).
// Best-effort: сбой отправки не прерывает сообщения клиенту.

import {
  Client,
  ClientEnrollment,
  Course,
  Questionnaire,
  QUESTIONNAIRE_QUESTIONS,
  sendAdminAlert,
  type QuestionnaireQuestion,
  type Report,
} from '@nutrition-bot/shared';
import type { Logger } from 'pino';

interface EnrollmentWithClient extends ClientEnrollment {
  client?: Client;
  course?: Course;
}

const SUMMARY_FIELDS: ReadonlyArray<{ id: string; title: string }> = [
  { id: 'goal', title: 'Цель' },
  { id: 'age', title: 'Возраст' },
  { id: 'weight', title: 'Вес' },
  { id: 'obstacles', title: 'Что мешает' },
  { id: 'eating_routine', title: 'Режим питания' },
  { id: 'activity', title: 'Активность' },
  { id: 'health', title: 'Здоровье' },
];

export interface AdminCourseSummaryInput {
  client: Pick<Client, 'firstName' | 'lastName' | 'telegramId' | 'telegramUsername'>;
  enrollment: Pick<ClientEnrollment, 'startDate' | 'endDate'>;
  report: Pick<
    Report,
    'periodStart' | 'periodEnd' | 'diaryStats' | 'adherencePercent' | 'problemAreas'
  >;
  courseName?: string | null;
  answers?: Record<string, unknown>;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function optionLabel(question: QuestionnaireQuestion | undefined, value: string): string {
  return question?.options?.find((option) => option.value === value)?.label ?? value;
}

function formatScalar(questionId: string, value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return questionId === 'weight' ? `${value} кг` : String(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return '';
}

function formatChoiceOrScalar(
  questionId: string,
  question: QuestionnaireQuestion | undefined,
  value: unknown,
): string {
  if (typeof value === 'string' && question?.type === 'single_choice') {
    return optionLabel(question, value);
  }
  return formatScalar(questionId, value);
}

/** Человекочитаемый ответ анкеты: подписи вариантов, free-text, приблизительные числа. */
export function formatQuestionnaireAnswer(questionId: string, raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }

  const question = QUESTIONNAIRE_QUESTIONS.find((item) => item.id === questionId);

  if (Array.isArray(raw)) {
    const labels = raw
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .map((item) => optionLabel(question, item));
    return labels.length > 0 ? labels.join(', ') : null;
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.values)) {
      const values = obj.values.filter((item): item is string => typeof item === 'string');
      const freeText = typeof obj.freeText === 'string' ? obj.freeText.trim() : '';
      const labels = values.map((value) => {
        const label = optionLabel(question, value);
        const option = question?.options?.find((item) => item.value === value);
        if (option?.allowFreeText && freeText.length > 0) {
          return `${label}: ${freeText}`;
        }
        return label;
      });
      return labels.length > 0 ? labels.join(', ') : null;
    }
    if ('value' in obj) {
      const formatted = formatChoiceOrScalar(questionId, question, obj.value);
      return formatted.length > 0 ? formatted : null;
    }
  }

  const formatted = formatChoiceOrScalar(questionId, question, raw);
  return formatted.length > 0 ? formatted : null;
}

export function formatClientDisplayName(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const last = lastName.trim();
  if (!last || last === '-') {
    return first || 'без имени';
  }
  return first ? `${first} ${last}` : last;
}

function formatTelegramContact(
  client: Pick<Client, 'telegramId' | 'telegramUsername'>,
): string | null {
  const parts: string[] = [];
  const username = client.telegramUsername?.trim();
  if (username) {
    parts.push(username.startsWith('@') ? username : `@${username}`);
  }
  if (client.telegramId) {
    parts.push(`id ${client.telegramId}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function formatAdminCourseCompletionMessage(input: AdminCourseSummaryInput): string {
  const { client, enrollment, report, courseName, answers = {} } = input;
  const stats = report.diaryStats;
  const days = stats.totalDays ?? 0;
  const records = stats.totalRecords ?? 0;
  const filled = stats.filledEntries ?? 0;

  const lines: string[] = [
    '🏁 <b>Курс завершён</b>',
    '',
    `<b>Клиент:</b> ${escapeHtml(formatClientDisplayName(client.firstName, client.lastName))}`,
  ];

  const telegram = formatTelegramContact(client);
  if (telegram) {
    lines.push(`Telegram: ${escapeHtml(telegram)}`);
  }

  if (courseName?.trim()) {
    lines.push(`Курс: ${escapeHtml(courseName.trim())}`);
  }

  const periodStart = report.periodStart || enrollment.startDate;
  const periodEnd = report.periodEnd || enrollment.endDate;
  const daysSuffix = days > 0 ? ` (${days} дн.)` : '';
  lines.push(`Период: ${periodStart} — ${periodEnd}${daysSuffix}`);

  const questionnaireLines: string[] = [];
  for (const field of SUMMARY_FIELDS) {
    const formatted = formatQuestionnaireAnswer(field.id, answers[field.id]);
    if (!formatted) continue;
    questionnaireLines.push(`• ${field.title}: ${escapeHtml(formatted)}`);
  }
  if (questionnaireLines.length > 0) {
    lines.push('', '<b>Анкета</b>', ...questionnaireLines);
  }

  lines.push('', '<b>Питание</b>');
  if (records === 0) {
    lines.push(`• Дневник: нет записей за ${days} дн.`);
  } else {
    lines.push(`• Дневник: ${filled} заполнено / ${records} записей за ${days} дн.`);
  }

  if (typeof stats.avgCalories === 'number') {
    lines.push(`• Средняя калорийность: ${stats.avgCalories} ккал/день`);
  }

  if (typeof report.adherencePercent === 'number') {
    lines.push(`• Соблюдение рекомендаций: ${report.adherencePercent}%`);
  }

  if (stats.topProducts && stats.topProducts.length > 0) {
    lines.push(`• Часто встречалось: ${escapeHtml(stats.topProducts.join(', '))}`);
  }

  const problems =
    report.problemAreas && report.problemAreas.length > 0
      ? report.problemAreas.map((item) => item.area)
      : (stats.topProblems ?? []);
  if (problems.length > 0) {
    lines.push(`• Проблемы: ${escapeHtml(problems.join(', '))}`);
  }

  return lines.join('\n');
}

export async function notifyAdminAboutCourseCompletion(
  enrollment: ClientEnrollment,
  report: Report,
  logger: Logger,
): Promise<void> {
  const enrollmentWithClient = enrollment as EnrollmentWithClient;
  const client = enrollmentWithClient.client;
  if (!client) {
    logger.info(
      { enrollmentId: enrollment.id },
      'Нет клиента в enrollment, сводку администратору не отправляем',
    );
    return;
  }

  try {
    const [course, questionnaire] = await Promise.all([
      enrollmentWithClient.course
        ? Promise.resolve(enrollmentWithClient.course)
        : Course.findByPk(enrollment.courseId),
      Questionnaire.findOne({
        where: { clientId: enrollment.clientId, status: 'completed' },
        order: [['completedAt', 'DESC']],
      }),
    ]);

    const text = formatAdminCourseCompletionMessage({
      client,
      enrollment,
      report,
      courseName: course?.name,
      answers: questionnaire?.answers ?? {},
    });

    await sendAdminAlert(text);
    logger.info(
      { enrollmentId: enrollment.id, clientId: client.id },
      'Администратору отправлена сводка о завершении курса',
    );
  } catch (err) {
    logger.error(
      { enrollmentId: enrollment.id, clientId: client.id, err },
      'Не удалось отправить администратору сводку о завершении курса',
    );
  }
}
