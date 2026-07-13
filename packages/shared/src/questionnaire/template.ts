// Шаблон вопросов онбординга.
// Источник: SA/anketa.md (10 вопросов). Поддерживает приблизительные ответы
// (ФТ-2, UserResearch — персона Анна) и free-text для варианта «Другое».

export const QUESTION_TYPES = ['text', 'number', 'single_choice', 'multi_choice'] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface QuestionnaireOption {
  value: string;
  label: string;
  /** Если true, клиент может ввести собственный текст вместо готового варианта. */
  allowFreeText?: boolean;
}

export interface QuestionnaireQuestion {
  id: string;
  text: string;
  type: QuestionType;
  /** Подсказка, показываемая под вопросом (опционально). */
  hint?: string;
  /** Для number-вопросов: разрешить текстовый/приблизительный ответ вместо цифры. */
  allowApproximate?: boolean;
  /** Для choice-вопросов. */
  options?: QuestionnaireOption[];
}

export const QUESTIONNAIRE_QUESTIONS: QuestionnaireQuestion[] = [
  {
    id: 'name',
    text: 'Как к вам обращаться?',
    type: 'text',
  },
  {
    id: 'age',
    text: 'Сколько вам лет?',
    type: 'number',
    allowApproximate: true,
    hint: 'Можно ответить примерно — например, «около 30»',
  },
  {
    id: 'weight',
    text: 'Укажите ваш текущий вес (кг)',
    type: 'number',
    allowApproximate: true,
    hint: 'Можно указать примерный вес — например, «примерно 70 кг»',
  },
  {
    id: 'goal',
    text: 'Какого результата вы хотите достичь в первую очередь?',
    type: 'single_choice',
    options: [
      { value: 'weight_loss', label: 'Снизить вес' },
      { value: 'reduce_swelling', label: 'Уменьшить отечность' },
      { value: 'improve_skin', label: 'Улучшить качество кожи' },
      { value: 'build_habits', label: 'Сформировать полезные привычки' },
      { value: 'maintain_form', label: 'Поддерживать текущую форму' },
      { value: 'improve_wellbeing', label: 'Улучшить общее самочувствие' },
    ],
  },
  {
    id: 'obstacles',
    text: 'Что сейчас больше всего мешает вам достичь этой цели?',
    type: 'multi_choice',
    options: [
      { value: 'no_time', label: 'Не хватает времени' },
      { value: 'no_routine', label: 'Не получается соблюдать режим питания' },
      { value: 'sweets', label: 'Часто тянет на сладкое или перекусы' },
      { value: 'no_motivation', label: 'Не хватает мотивации' },
      { value: 'stress', label: 'Испытываю постоянный стресс' },
      { value: 'dont_know', label: 'Не знаю, с чего начать' },
      { value: 'other', label: 'Другое', allowFreeText: true },
    ],
  },
  {
    id: 'eating_routine',
    text: 'Как бы вы оценили свой текущий режим питания?',
    type: 'single_choice',
    options: [
      { value: 'irregular', label: 'Питаюсь нерегулярно' },
      { value: '1_2_meals', label: 'Обычно ем 1-2 раза в день' },
      { value: 'regular_not_balanced', label: 'Питаюсь регулярно, но не всегда сбалансированно' },
      { value: 'mostly_healthy', label: 'В целом придерживаюсь здорового питания' },
      { value: 'mindful', label: 'Осознанно слежу за своим рационом' },
    ],
  },
  {
    id: 'activity',
    text: 'Какой у вас уровень физической активности?',
    type: 'single_choice',
    options: [
      { value: 'none', label: 'Почти нет физической активности' },
      { value: 'light', label: 'Ежедневные прогулки или легкая активность' },
      { value: '1_2_week', label: 'Тренируюсь 1-2 раза в неделю' },
      { value: '3_4_week', label: 'Тренируюсь 3-4 раза в неделю' },
      { value: '5_plus_week', label: 'Тренируюсь 5 и более раз в неделю' },
    ],
  },
  {
    id: 'water',
    text: 'Сколько чистой воды вы обычно выпиваете за день?',
    type: 'single_choice',
    options: [
      { value: 'less_1l', label: 'Менее 1 литра' },
      { value: '1_1_5l', label: '1-1,5 литра' },
      { value: '1_5_2l', label: '1,5-2 литра' },
      { value: 'more_2l', label: 'Более 2 литров' },
      { value: 'not_tracking', label: 'Не отслеживаю' },
    ],
  },
  {
    id: 'sleep',
    text: 'Как вы оцениваете качество своего сна?',
    type: 'single_choice',
    options: [
      { value: 'not_enough', label: 'Часто не высыпаюсь' },
      { value: 'unstable', label: 'Сон нестабильный' },
      { value: 'mostly_good', label: 'В основном высыпаюсь' },
      { value: 'good', label: 'Сплю хорошо и регулярно' },
    ],
  },
  {
    id: 'health',
    text: 'Есть ли у вас особенности здоровья, которые важно учитывать при составлении рекомендаций?',
    type: 'multi_choice',
    options: [
      { value: 'none', label: 'Нет' },
      { value: 'pregnancy', label: 'Беременность или грудное вскармливание' },
      { value: 'thyroid', label: 'Заболевания щитовидной железы' },
      { value: 'diabetes', label: 'Сахарный диабет' },
      { value: 'gi', label: 'Заболевания желудочно-кишечного тракта' },
      { value: 'other', label: 'Другое (поле для ввода)', allowFreeText: true },
    ],
  },
];

export const TOTAL_QUESTIONNAIRE_QUESTIONS = QUESTIONNAIRE_QUESTIONS.length;
