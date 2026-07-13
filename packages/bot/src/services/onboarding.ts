// State machine онбординга: welcome → questionnaire → settings (roadmap 3.8).
// Реализует ФТ-2: приветствие, пошаговую анкету из SA/anketa.md, сохранение прогресса
// и переход к настройкам уведомлений (ФТ-3). Учитывает приблизительные ответы
// (UserResearch, персона Анна) без жёсткой блокировки при отсутствии цифр.

import {
  ClientEnrollment,
  Questionnaire,
  QUESTIONNAIRE_QUESTIONS,
  TOTAL_QUESTIONNAIRE_QUESTIONS,
  type QuestionnaireQuestion,
} from '@nutrition-bot/shared';
import type { BotContext } from '../context.js';

const WELCOME_MESSAGE =
  'Привет! Я ваш виртуальный консультант по питанию 🤍\n\n' +
  'Каждый день я буду мягко напоминать заполнить дневник питания, а в конце курса ' +
  'подготовлю персональный отчёт. Без осуждения, только поддержка.\n\n' +
  'Для начала задам несколько коротких вопросов — так бот сможет лучше понимать ваши привычки.';

const COMPLETED_MESSAGE =
  'Спасибо! Анкета заполнена 🎉\n\n' +
  'Теперь настроим уведомления, чтобы я не беспокоил вас в неудобное время.';

const SETTINGS_PENDING_MESSAGE =
  'Сейчас мы настроим расписание напоминаний. Отправьте /settings, когда будете готовы.';

const EMPTY_ANSWER_MESSAGE = 'Пожалуйста, напишите ответ на вопрос.';
const INVALID_OPTION_MESSAGE = 'Не совсем понял. Выберите один из предложенных вариантов.';
const INVALID_MULTI_OPTION_MESSAGE =
  'Не совсем понял. Перечислите номера вариантов через запятую, например: 1, 3, 5.';

interface ParsedAnswer {
  value: unknown;
  display: string;
}

function formatQuestion(question: QuestionnaireQuestion, index: number): string {
  let text = `Вопрос ${index + 1} из ${TOTAL_QUESTIONNAIRE_QUESTIONS}\n\n${question.text}`;
  if (question.options) {
    text += '\n';
    for (let i = 0; i < question.options.length; i++) {
      const option = question.options[i];
      if (option) {
        text += `\n${i + 1}. ${option.label}`;
      }
    }
    text += '\n\nОтветьте номером варианта';
    if (question.type === 'multi_choice') {
      text += ' или несколькими номерами через запятую';
    }
    text += '.';
  }
  if (question.hint) {
    text += `\n\n_${question.hint}_`;
  }
  return text;
}

function parseNumberAnswer(text: string): ParsedAnswer {
  const normalized = text.replace(',', '.').trim();
  const numeric = Number(normalized);
  if (!Number.isNaN(numeric) && normalized !== '') {
    return { value: { value: numeric, approximate: false }, display: normalized };
  }
  return { value: { value: text.trim(), approximate: true }, display: text.trim() };
}

function findOptionByText(question: QuestionnaireQuestion, text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  if (!question.options) return null;

  const numericIndex = Number(trimmed);
  if (!Number.isNaN(numericIndex) && trimmed !== '') {
    const option = question.options[numericIndex - 1];
    if (option) return numericIndex - 1;
  }

  const byLabel = question.options.findIndex((opt) => opt.label.toLowerCase() === trimmed);
  if (byLabel >= 0) return byLabel;

  const byValue = question.options.findIndex((opt) => opt.value.toLowerCase() === trimmed);
  if (byValue >= 0) return byValue;

  return null;
}

function parseSingleChoiceAnswer(
  question: QuestionnaireQuestion,
  text: string,
): ParsedAnswer | null {
  const index = findOptionByText(question, text);
  if (index === null) return null;
  const option = question.options?.[index];
  if (!option) return null;
  return { value: option.value, display: option.label };
}

function parseMultiChoiceAnswer(
  question: QuestionnaireQuestion,
  text: string,
): ParsedAnswer | null {
  if (!question.options) return null;
  const parts = text
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const values: string[] = [];
  for (const part of parts) {
    const index = findOptionByText(question, part);
    if (index === null) return null;
    const option = question.options[index];
    if (!option) return null;
    if (!values.includes(option.value)) {
      values.push(option.value);
    }
  }

  const display = values
    .map((value) => question.options?.find((opt) => opt.value === value)?.label ?? value)
    .join(', ');
  return { value: values, display };
}

function parseAnswer(question: QuestionnaireQuestion, text: string): ParsedAnswer | null {
  if (text.trim() === '') return null;

  switch (question.type) {
    case 'text':
      return { value: text.trim(), display: text.trim() };
    case 'number':
      return parseNumberAnswer(text);
    case 'single_choice':
      return parseSingleChoiceAnswer(question, text);
    case 'multi_choice':
      return parseMultiChoiceAnswer(question, text);
    default:
      return { value: text.trim(), display: text.trim() };
  }
}

async function loadOrCreateQuestionnaire(enrollment: ClientEnrollment): Promise<Questionnaire> {
  const questionnaire = await Questionnaire.findOne({
    where: { clientEnrollmentId: enrollment.id, status: 'in_progress' },
  });
  if (questionnaire) return questionnaire;

  return Questionnaire.create({
    clientEnrollmentId: enrollment.id,
    clientId: enrollment.clientId,
    answers: {},
    currentQuestion: 0,
    status: 'in_progress',
  });
}

async function askCurrentQuestion(ctx: BotContext, questionnaire: Questionnaire): Promise<void> {
  const question = QUESTIONNAIRE_QUESTIONS[questionnaire.currentQuestion];
  if (!question) {
    return;
  }
  await ctx.reply(formatQuestion(question, questionnaire.currentQuestion), {
    parse_mode: 'Markdown',
  });
}

/** Отправляет приветствие, создаёт анкету и задаёт первый вопрос. */
export async function startOnboarding(
  ctx: BotContext,
  enrollment: ClientEnrollment,
): Promise<void> {
  if (enrollment.onboardingStatus === 'pending') {
    await enrollment.update({ onboardingStatus: 'in_progress' });
  }

  await ctx.reply(WELCOME_MESSAGE);

  const questionnaire = await loadOrCreateQuestionnaire(enrollment);
  await askCurrentQuestion(ctx, questionnaire);
}

/** Продолжает анкету с текущего вопроса (например, после возвращения клиента). */
export async function continueQuestionnaire(
  ctx: BotContext,
  enrollment: ClientEnrollment,
): Promise<void> {
  const questionnaire = await loadOrCreateQuestionnaire(enrollment);
  await askCurrentQuestion(ctx, questionnaire);
}

/** Сохраняет ответ на текущий вопрос и задаёт следующий или завершает анкету. */
export async function handleQuestionnaireAnswer(
  ctx: BotContext,
  enrollment: ClientEnrollment,
  text: string,
): Promise<void> {
  const questionnaire = await loadOrCreateQuestionnaire(enrollment);
  const questionIndex = questionnaire.currentQuestion;
  const question = QUESTIONNAIRE_QUESTIONS[questionIndex];

  if (!question) {
    // Анкета уже завершена, но enrollment ещё не переведён в settings_pending.
    await completeQuestionnaire(ctx, enrollment);
    return;
  }

  const parsed = parseAnswer(question, text);
  if (parsed === null) {
    const errorMessage =
      question.type === 'multi_choice' ? INVALID_MULTI_OPTION_MESSAGE : INVALID_OPTION_MESSAGE;
    await ctx.reply(question.options ? errorMessage : EMPTY_ANSWER_MESSAGE);
    await askCurrentQuestion(ctx, questionnaire);
    return;
  }

  const answers = { ...questionnaire.answers, [question.id]: parsed.value };
  const nextIndex = questionIndex + 1;
  const now = new Date();

  if (nextIndex >= TOTAL_QUESTIONNAIRE_QUESTIONS) {
    await questionnaire.update({
      answers,
      currentQuestion: nextIndex,
      status: 'completed',
      lastAnswerAt: now,
      completedAt: now,
    });
    await completeQuestionnaire(ctx, enrollment);
    return;
  }

  await questionnaire.update({
    answers,
    currentQuestion: nextIndex,
    lastAnswerAt: now,
  });

  await askCurrentQuestion(ctx, questionnaire);
}

/** Завершает анкету и переводит enrollment в статус ожидания настроек. */
export async function completeQuestionnaire(
  ctx: BotContext,
  enrollment: ClientEnrollment,
): Promise<void> {
  await enrollment.update({ onboardingStatus: 'settings_pending' });
  await ctx.reply(COMPLETED_MESSAGE);
  await ctx.reply(SETTINGS_PENDING_MESSAGE);
}
