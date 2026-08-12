// State machine онбординга: welcome → questionnaire → settings (roadmap 3.8).
// Реализует ФТ-2: приветствие, пошаговую анкету из SA/anketa.md, сохранение прогресса
// и переход к настройкам уведомлений (ФТ-3). Варианты — через inline-кнопки (SA/adminAPI.md §6.4).

import {
  Client,
  ClientEnrollment,
  Questionnaire,
  QUESTIONNAIRE_QUESTIONS,
  sendTelegramMessage,
  TOTAL_QUESTIONNAIRE_QUESTIONS,
  type QuestionnaireQuestion,
} from '@nutrition-bot/shared';
import { InlineKeyboard } from 'grammy';
import { startSettingsWizard } from '../handlers/settings-handler.js';
import type { BotContext } from '../context.js';

/** id вопроса «Как к вам обращаться?» — ответ должен попасть в Client.firstName. */
const PREFERRED_NAME_QUESTION_ID = 'name';

const WELCOME_MESSAGE =
  'Здравствуйте! Я — ваш виртуальный консультант по питанию 🤍\n\n' +
  'Моя задача — мягко помогать вам следить за питанием: каждый день я буду напоминать заполнить дневник, ' +
  'анализировать ваши привычки и присылать персональные рекомендации. В конце курса вы получите итоговый отчёт о прогрессе.\n\n' +
  'Без осуждения и строгих требований — только поддержка.\n\n' +
  'Чтобы я мог лучше понимать ваши цели и образ жизни, задам несколько коротких вопросов. Это займёт буквально пару минут.';

const COMPLETED_MESSAGE =
  'Спасибо! Анкета заполнена 🎉\n\n' +
  'Теперь настроим уведомления, чтобы я не беспокоил вас в неудобное время.';

const EMPTY_ANSWER_MESSAGE = 'Пожалуйста, напишите ответ на вопрос.';
const USE_BUTTONS_MESSAGE = 'Пожалуйста, выберите вариант из меню ниже.';
const MULTI_MIN_MESSAGE = 'Выберите хотя бы один вариант, затем нажмите «Готово».';
const FREE_TEXT_PROMPT = 'Напишите своими словами — я учту это в рекомендациях.';
const INVALID_CALLBACK_MESSAGE = 'Этот вопрос уже пройден. Продолжаем с текущего.';

interface ParsedAnswer {
  value: unknown;
  display: string;
}

/** Черновик мультивыбора в answers[questionId] до нажатия «Готово». */
interface MultiDraft {
  values: string[];
  awaitingFreeText?: boolean;
  freeText?: string;
}

function isMultiDraft(value: unknown): value is MultiDraft {
  return typeof value === 'object' && value !== null && Array.isArray((value as MultiDraft).values);
}

function formatQuestion(question: QuestionnaireQuestion, index: number): string {
  let text = `Вопрос ${index + 1} из ${TOTAL_QUESTIONNAIRE_QUESTIONS}\n\n${question.text}`;
  if (question.type === 'multi_choice') {
    text += '\n\nМожно выбрать несколько вариантов. Нажмите «Готово», когда закончите.';
  }
  if (question.hint) {
    text += `\n\n_${question.hint}_`;
  }
  return text;
}

function buildSingleChoiceKeyboard(
  questionIndex: number,
  question: QuestionnaireQuestion,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < (question.options?.length ?? 0); i++) {
    const option = question.options?.[i];
    if (!option) continue;
    keyboard.row(InlineKeyboard.text(option.label, `q:${questionIndex}:opt:${i}`));
  }
  return keyboard;
}

function buildMultiChoiceKeyboard(
  questionIndex: number,
  question: QuestionnaireQuestion,
  selected: ReadonlySet<string>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < (question.options?.length ?? 0); i++) {
    const option = question.options?.[i];
    if (!option) continue;
    const mark = selected.has(option.value) ? '✅ ' : '';
    keyboard.row(InlineKeyboard.text(`${mark}${option.label}`, `q:${questionIndex}:toggle:${i}`));
  }
  keyboard.row(InlineKeyboard.text('Готово', `q:${questionIndex}:done`));
  return keyboard;
}

function buildQuestionKeyboard(
  question: QuestionnaireQuestion,
  questionIndex: number,
  draftValues: string[] = [],
): InlineKeyboard | undefined {
  if (question.type === 'single_choice') {
    return buildSingleChoiceKeyboard(questionIndex, question);
  }
  if (question.type === 'multi_choice') {
    return buildMultiChoiceKeyboard(questionIndex, question, new Set(draftValues));
  }
  return undefined;
}

function parseNumberAnswer(text: string, allowApproximate: boolean): ParsedAnswer | null {
  const normalized = text.replace(',', '.').trim();
  const numeric = Number(normalized);
  if (!Number.isNaN(numeric) && normalized !== '') {
    return { value: { value: numeric, approximate: false }, display: normalized };
  }
  if (!allowApproximate) {
    return null;
  }
  return { value: { value: text.trim(), approximate: true }, display: text.trim() };
}

function getDraftValues(questionnaire: Questionnaire, question: QuestionnaireQuestion): string[] {
  const raw = questionnaire.answers[question.id];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string');
  }
  if (isMultiDraft(raw)) {
    return raw.values;
  }
  return [];
}

function isAwaitingFreeText(
  questionnaire: Questionnaire,
  question: QuestionnaireQuestion,
): boolean {
  const raw = questionnaire.answers[question.id];
  return isMultiDraft(raw) && raw.awaitingFreeText === true;
}

function optionNeedsFreeText(question: QuestionnaireQuestion, values: string[]): boolean {
  return (question.options ?? []).some((opt) => opt.allowFreeText && values.includes(opt.value));
}

function formatMultiDisplay(
  question: QuestionnaireQuestion,
  values: string[],
  freeText?: string,
): string {
  const labels = values.map((value) => {
    const option = question.options?.find((opt) => opt.value === value);
    if (option?.allowFreeText && freeText) {
      return `${option.label}: ${freeText}`;
    }
    return option?.label ?? value;
  });
  return labels.join(', ');
}

function toggleMultiValue(
  question: QuestionnaireQuestion,
  current: string[],
  optionValue: string,
): string[] {
  const isSelected = current.includes(optionValue);
  let next = isSelected ? current.filter((v) => v !== optionValue) : [...current, optionValue];

  // «Нет» взаимоисключающе с остальными вариантами (вопрос про здоровье).
  if (optionValue === 'none' && !isSelected) {
    next = ['none'];
  } else if (optionValue !== 'none' && next.includes('none')) {
    next = next.filter((v) => v !== 'none');
  }

  // Не даём выбрать несуществующие value — только из options.
  const allowed = new Set((question.options ?? []).map((opt) => opt.value));
  return next.filter((v) => allowed.has(v));
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

/**
 * Синхронизирует ответ «Как к вам обращаться?» с Client.firstName.
 * Нужно и при первом, и при повторном онбординге: иначе AI/сводки продолжают
 * обращаться по старому имени из предыдущего курса.
 */
async function syncPreferredNameToClient(
  ctx: BotContext,
  enrollment: ClientEnrollment,
  preferredName: string,
): Promise<void> {
  const trimmed = preferredName.trim();
  if (!trimmed) return;

  if (ctx.client && ctx.client.id === enrollment.clientId) {
    await ctx.client.update({ firstName: trimmed });
    return;
  }

  const client = await Client.findByPk(enrollment.clientId);
  if (client) {
    await client.update({ firstName: trimmed });
  }
}

async function askCurrentQuestion(ctx: BotContext, questionnaire: Questionnaire): Promise<void> {
  const questionIndex = questionnaire.currentQuestion;
  const question = QUESTIONNAIRE_QUESTIONS[questionIndex];
  if (!question) {
    return;
  }

  if (isAwaitingFreeText(questionnaire, question)) {
    await ctx.reply(FREE_TEXT_PROMPT);
    return;
  }

  const draftValues =
    question.type === 'multi_choice' ? getDraftValues(questionnaire, question) : [];
  const replyMarkup = buildQuestionKeyboard(question, questionIndex, draftValues);

  await ctx.reply(formatQuestion(question, questionIndex), {
    parse_mode: 'Markdown',
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function sendWelcomeMessage(ctx: BotContext): Promise<void> {
  const client = ctx.client;
  if (!client?.telegramId) {
    // Fallback на случай, если telegramId почему-то недоступен в контексте.
    await ctx.reply(WELCOME_MESSAGE);
    return;
  }

  await sendTelegramMessage({
    telegramId: client.telegramId,
    text: WELCOME_MESSAGE,
    clientId: client.id,
    type: 'info',
    category: 'transactional',
    parseMode: 'Markdown',
  });
}

async function commitAnswerAndAdvance(
  ctx: BotContext,
  enrollment: ClientEnrollment,
  questionnaire: Questionnaire,
  question: QuestionnaireQuestion,
  questionIndex: number,
  value: unknown,
  display: string,
): Promise<void> {
  const answers = { ...questionnaire.answers, [question.id]: value };
  const nextIndex = questionIndex + 1;
  const now = new Date();

  try {
    await ctx.editMessageText(
      `Вопрос ${questionIndex + 1} из ${TOTAL_QUESTIONNAIRE_QUESTIONS}\n\n${question.text}\n\n✓ ${display}`,
      { reply_markup: { inline_keyboard: [] } },
    );
  } catch {
    // Сообщение могло быть не от callback (или уже изменено) — не блокируем прогресс.
  }

  if (nextIndex >= TOTAL_QUESTIONNAIRE_QUESTIONS) {
    await questionnaire.update({
      answers,
      currentQuestion: nextIndex,
      status: 'completed',
      lastAnswerAt: now,
      completedAt: now,
    });
    await completeQuestionnaire(ctx, enrollment);
    await startSettingsWizard(ctx);
    return;
  }

  await questionnaire.update({
    answers,
    currentQuestion: nextIndex,
    lastAnswerAt: now,
  });

  await askCurrentQuestion(ctx, questionnaire);
}

/** Отправляет приветствие, создаёт анкету и задаёт первый вопрос. */
export async function startOnboarding(
  ctx: BotContext,
  enrollment: ClientEnrollment,
): Promise<void> {
  // Продление/повторный курс (ФТ-18): enrollment уже с onboardingStatus=completed —
  // анкету и настройки не запускаем повторно.
  if (enrollment.onboardingStatus === 'completed') {
    return;
  }

  if (enrollment.onboardingStatus === 'settings_pending') {
    await startSettingsWizard(ctx);
    return;
  }

  if (enrollment.onboardingStatus === 'pending') {
    await enrollment.update({ onboardingStatus: 'in_progress' });
  }

  await sendWelcomeMessage(ctx);

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

/**
 * Текстовый ответ: только text/number или дописка к «Другое» после мультивыбора.
 * Choice-вопросы принимаются через inline-кнопки.
 */
export async function handleQuestionnaireAnswer(
  ctx: BotContext,
  enrollment: ClientEnrollment,
  text: string,
): Promise<void> {
  const questionnaire = await loadOrCreateQuestionnaire(enrollment);
  const questionIndex = questionnaire.currentQuestion;
  const question = QUESTIONNAIRE_QUESTIONS[questionIndex];

  if (!question) {
    await completeQuestionnaire(ctx, enrollment);
    return;
  }

  if (isAwaitingFreeText(questionnaire, question)) {
    const trimmed = text.trim();
    if (trimmed === '') {
      await ctx.reply(FREE_TEXT_PROMPT);
      return;
    }
    const draft = questionnaire.answers[question.id];
    const values = isMultiDraft(draft) ? draft.values : getDraftValues(questionnaire, question);
    const value = { values, freeText: trimmed };
    await commitAnswerAndAdvance(
      ctx,
      enrollment,
      questionnaire,
      question,
      questionIndex,
      value,
      formatMultiDisplay(question, values, trimmed),
    );
    return;
  }

  if (question.type === 'single_choice' || question.type === 'multi_choice') {
    await ctx.reply(USE_BUTTONS_MESSAGE);
    await askCurrentQuestion(ctx, questionnaire);
    return;
  }

  if (text.trim() === '') {
    await ctx.reply(EMPTY_ANSWER_MESSAGE);
    await askCurrentQuestion(ctx, questionnaire);
    return;
  }

  let parsed: ParsedAnswer | null = null;
  if (question.type === 'text') {
    parsed = { value: text.trim(), display: text.trim() };
  } else if (question.type === 'number') {
    parsed = parseNumberAnswer(text, question.allowApproximate ?? false);
  }

  if (parsed === null) {
    await ctx.reply(EMPTY_ANSWER_MESSAGE);
    await askCurrentQuestion(ctx, questionnaire);
    return;
  }

  if (question.id === PREFERRED_NAME_QUESTION_ID && typeof parsed.value === 'string') {
    await syncPreferredNameToClient(ctx, enrollment, parsed.value);
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
    await startSettingsWizard(ctx);
    return;
  }

  await questionnaire.update({
    answers,
    currentQuestion: nextIndex,
    lastAnswerAt: now,
  });

  await askCurrentQuestion(ctx, questionnaire);
}

/** Обработка нажатий inline-кнопок анкеты (`q:{qi}:opt|toggle|done:...`). */
export async function handleQuestionnaireCallback(
  ctx: BotContext,
  enrollment: ClientEnrollment,
  callbackData: string,
): Promise<void> {
  const parts = callbackData.split(':');
  if (parts[0] !== 'q' || parts.length < 3) {
    return;
  }

  const questionIndex = Number(parts[1]);
  const action = parts[2];
  const optionIndex = parts[3] !== undefined ? Number(parts[3]) : NaN;

  const questionnaire = await loadOrCreateQuestionnaire(enrollment);

  if (
    Number.isNaN(questionIndex) ||
    questionIndex !== questionnaire.currentQuestion ||
    questionnaire.status !== 'in_progress'
  ) {
    await ctx.answerCallbackQuery({ text: INVALID_CALLBACK_MESSAGE });
    await askCurrentQuestion(ctx, questionnaire);
    return;
  }

  const question = QUESTIONNAIRE_QUESTIONS[questionIndex];
  if (!question?.options) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (action === 'opt' && question.type === 'single_choice') {
    const option = question.options[optionIndex];
    if (!option || Number.isNaN(optionIndex)) {
      await ctx.answerCallbackQuery({ text: 'Некорректный вариант.' });
      return;
    }
    await ctx.answerCallbackQuery();
    await commitAnswerAndAdvance(
      ctx,
      enrollment,
      questionnaire,
      question,
      questionIndex,
      option.value,
      option.label,
    );
    return;
  }

  if (action === 'toggle' && question.type === 'multi_choice') {
    const option = question.options[optionIndex];
    if (!option || Number.isNaN(optionIndex)) {
      await ctx.answerCallbackQuery({ text: 'Некорректный вариант.' });
      return;
    }

    const current = getDraftValues(questionnaire, question);
    const nextValues = toggleMultiValue(question, current, option.value);
    const answers = {
      ...questionnaire.answers,
      [question.id]: { values: nextValues } satisfies MultiDraft,
    };
    await questionnaire.update({ answers, lastAnswerAt: new Date() });

    await ctx.editMessageText(formatQuestion(question, questionIndex), {
      parse_mode: 'Markdown',
      reply_markup: buildMultiChoiceKeyboard(questionIndex, question, new Set(nextValues)),
    });
    await ctx.answerCallbackQuery();
    return;
  }

  if (action === 'done' && question.type === 'multi_choice') {
    const values = getDraftValues(questionnaire, question);
    if (values.length === 0) {
      await ctx.answerCallbackQuery({ text: MULTI_MIN_MESSAGE });
      return;
    }

    if (optionNeedsFreeText(question, values)) {
      const answers = {
        ...questionnaire.answers,
        [question.id]: { values, awaitingFreeText: true } satisfies MultiDraft,
      };
      await questionnaire.update({ answers, lastAnswerAt: new Date() });
      await ctx.editMessageText(
        `Вопрос ${questionIndex + 1} из ${TOTAL_QUESTIONNAIRE_QUESTIONS}\n\n${question.text}\n\n✓ ${formatMultiDisplay(question, values)}`,
        { reply_markup: { inline_keyboard: [] } },
      );
      await ctx.answerCallbackQuery();
      await ctx.reply(FREE_TEXT_PROMPT);
      return;
    }

    await ctx.answerCallbackQuery();
    await commitAnswerAndAdvance(
      ctx,
      enrollment,
      questionnaire,
      question,
      questionIndex,
      values,
      formatMultiDisplay(question, values),
    );
    return;
  }

  await ctx.answerCallbackQuery();
}

/** Завершает анкету и переводит enrollment в статус ожидания настроек. */
export async function completeQuestionnaire(
  ctx: BotContext,
  enrollment: ClientEnrollment,
): Promise<void> {
  await enrollment.update({ onboardingStatus: 'settings_pending' });
  await ctx.reply(COMPLETED_MESSAGE);
}
