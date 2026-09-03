// Сценарные тесты бота по CJM (roadmap 13.6, ФТ-2, ФТ-3, ФТ-5).
// Хендлеры вызываются с поддельным ctx в той же цепочке, что собирает bot.ts
// (middleware контекста → обработчик), но состояние живёт в настоящей тестовой БД:
// путь «ссылка → анкета → настройки → дневник → рекомендация» проверяется по
// фактическим переходам onboardingStatus, а не по вызовам моков.
//
// Наружу не выходит ничего: доставка в Telegram заменена моком `sendTelegramMessage`,
// AI-движок — `MockAIEngine` (AI_PROVIDER=mock), сеть не используется.

import { format, toZonedTime } from 'date-fns-tz';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallbackQueryContext, CommandContext, NextFunction } from 'grammy';
import { setupTestDatabase, truncateTestDatabase } from '@nutrition-bot/shared/testing';

const aiQueue = vi.hoisted(() => ({ pending: [] as Promise<unknown>[] }));

vi.mock('@nutrition-bot/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nutrition-bot/shared')>()),
  sendTelegramMessage: vi.fn(),
}));

vi.mock('@nutrition-bot/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nutrition-bot/ai')>();
  return {
    ...actual,
    // Обработка остаётся настоящей — подменяется только момент ожидания: хендлер
    // запускает её как fire-and-forget, а тест дожидается через drainAiQueue().
    processDiaryEntry: vi.fn((entryId: string) => {
      const promise = actual.processDiaryEntry(entryId);
      aiQueue.pending.push(promise);
      return promise;
    }),
  };
});

import {
  Client,
  ClientEnrollment,
  Course,
  createLogger,
  DEFAULT_TIMEZONE,
  EnrollmentLink,
  EnrollmentLinkAttempt,
  NotificationSettings,
  NutritionDiary,
  Questionnaire,
  Recommendation,
  sendTelegramMessage,
} from '@nutrition-bot/shared';
import { processDiaryEntry, resetAIEngine } from '@nutrition-bot/ai';
import { createStartHandler } from './commands/start.js';
import type { BotContext } from './context.js';
import { adminTextMiddleware } from './handlers/admin-handler.js';
import { onboardingMessageHandler } from './handlers/onboarding-handler.js';
import { handleQuestionnaireButton } from './handlers/questionnaire-handler.js';
import { handleSettingsCallback } from './handlers/settings-handler.js';
import { createClientContextMiddleware } from './middleware/client-context.js';

const TELEGRAM_ID = 500_100_900;
const LINK_CODE = 'cjmTestCode00001';
const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const logger = createLogger('bot');
const middleware = createClientContextMiddleware(logger);
const startHandler = createStartHandler(logger);

interface FakeUpdate {
  text?: string;
  callbackData?: string;
  match?: string;
}

interface FakeContext {
  ctx: BotContext;
  replies: string[];
  edits: string[];
  callbackAnswers: (string | undefined)[];
}

function createContext(update: FakeUpdate): FakeContext {
  const replies: string[] = [];
  const edits: string[] = [];
  const callbackAnswers: (string | undefined)[] = [];

  const ctx = {
    from: { id: TELEGRAM_ID, username: 'cjm_client' },
    ...(update.text === undefined ? {} : { message: { text: update.text } }),
    ...(update.callbackData === undefined ? {} : { callbackQuery: { data: update.callbackData } }),
    match: update.match ?? '',
    reply: vi.fn((text: string) => {
      replies.push(text);
      return Promise.resolve();
    }),
    editMessageText: vi.fn((text: string) => {
      edits.push(text);
      return Promise.resolve();
    }),
    answerCallbackQuery: vi.fn((options?: { text?: string }) => {
      callbackAnswers.push(options?.text);
      return Promise.resolve();
    }),
    api: { sendMessage: vi.fn() },
  };

  return { ctx: ctx as unknown as BotContext, replies, edits, callbackAnswers };
}

/** `/start <payload>` — как `bot.command('start', ...)` после middleware контекста. */
async function sendStart(payload: string): Promise<FakeContext> {
  const fake = createContext({ match: payload });
  await middleware(fake.ctx, () => startHandler(fake.ctx as CommandContext<BotContext>));
  return fake;
}

/** Текстовое сообщение — цепочка `adminTextMiddleware` → `onboardingMessageHandler`. */
async function sendText(text: string): Promise<FakeContext> {
  const fake = createContext({ text });
  const next: NextFunction = () => onboardingMessageHandler(fake.ctx);
  await middleware(fake.ctx, () => adminTextMiddleware(fake.ctx, next));
  return fake;
}

/** Нажатие inline-кнопки: маршрутизация по префиксу callback_data, как в bot.ts. */
async function pressButton(callbackData: string): Promise<FakeContext> {
  const fake = createContext({ callbackData });
  const callbackCtx = fake.ctx as CallbackQueryContext<BotContext>;
  await middleware(fake.ctx, () =>
    callbackData.startsWith('q:')
      ? handleQuestionnaireButton(callbackCtx)
      : handleSettingsCallback(callbackCtx),
  );
  return fake;
}

async function drainAiQueue(): Promise<void> {
  while (aiQueue.pending.length > 0) {
    await Promise.allSettled(aiQueue.pending.splice(0));
  }
}

interface SeedOptions {
  onboardingStatus?: 'pending' | 'in_progress' | 'settings_pending' | 'completed';
  linkExpiresAt?: Date;
  linkStatus?: 'active' | 'used' | 'revoked' | 'expired';
  telegramId?: string | null;
  usedByTelegramId?: string | null;
}

interface Seeded {
  clientId: string;
  enrollmentId: string;
  linkId: string;
}

/** Состояние «администратор завёл клиента и выдал ссылку», telegramId ещё не привязан. */
async function seedInvitedClient(options: SeedOptions = {}): Promise<Seeded> {
  const course = await Course.create({
    name: 'Курс 30 дней',
    durationDays: 30,
    startDate: '2026-02-01',
    endDate: '2026-03-03',
  });

  const client = await Client.create({
    firstName: 'Клиент',
    lastName: 'Студии',
    email: null,
    phone: null,
    ...(options.telegramId === undefined ? {} : { telegramId: options.telegramId }),
  });

  await NotificationSettings.create({ clientId: client.id });

  const enrollment = await ClientEnrollment.create({
    clientId: client.id,
    courseId: course.id,
    startDate: '2026-02-01',
    endDate: '2026-03-03',
    ...(options.onboardingStatus ? { onboardingStatus: options.onboardingStatus } : {}),
  });

  const link = await EnrollmentLink.create({
    enrollmentId: enrollment.id,
    code: LINK_CODE,
    expiresAt: options.linkExpiresAt ?? new Date(Date.now() + LINK_LIFETIME_MS),
    ...(options.linkStatus ? { status: options.linkStatus } : {}),
    // Констрейнт enrollment_links_used_at_consistency: status='used' ⇔ used_at задан.
    ...(options.linkStatus === 'used'
      ? {
          usedAt: new Date(),
          ...(options.usedByTelegramId ? { usedByTelegramId: options.usedByTelegramId } : {}),
        }
      : {}),
  });

  return { clientId: client.id, enrollmentId: enrollment.id, linkId: link.id };
}

async function reloadEnrollment(enrollmentId: string): Promise<ClientEnrollment> {
  const enrollment = await ClientEnrollment.findByPk(enrollmentId);
  if (!enrollment) {
    throw new Error(`ClientEnrollment ${enrollmentId} исчез из тестовой БД`);
  }
  return enrollment;
}

async function loadQuestionnaire(enrollmentId: string): Promise<Questionnaire> {
  const questionnaire = await Questionnaire.findOne({
    where: { clientEnrollmentId: enrollmentId },
  });
  if (!questionnaire) {
    throw new Error(`Анкета для enrollment ${enrollmentId} не создана`);
  }
  return questionnaire;
}

/** Проходит анкету до конца: 3 текстовых ответа + 7 вопросов с кнопками. */
async function completeQuestionnaireFlow(): Promise<void> {
  await sendText('Анна');
  await sendText('около 30');
  await sendText('68,5');
  await pressButton('q:3:opt:0');
  await pressButton('q:4:toggle:0');
  await pressButton('q:4:done');
  await pressButton('q:5:opt:2');
  await pressButton('q:6:opt:1');
  await pressButton('q:7:opt:2');
  await pressButton('q:8:opt:1');
  await pressButton('q:9:toggle:0');
  await pressButton('q:9:done');
}

/** Проходит визард настроек до `onboardingStatus = completed`. */
async function completeSettingsFlow(): Promise<void> {
  await pressButton('settings:time:09:00');
  await pressButton('settings:freq:daily');
  await pressButton('settings:types_done');
}

function localTime(date: Date): string {
  return format(toZonedTime(date, DEFAULT_TIMEZONE), 'HH:mm', { timeZone: DEFAULT_TIMEZONE });
}

beforeAll(async () => {
  await setupTestDatabase();
  // Гарантируем детерминированный движок независимо от локального .env.
  process.env.AI_PROVIDER = 'mock';
  resetAIEngine();
});

beforeEach(async () => {
  vi.clearAllMocks();
  aiQueue.pending.length = 0;
  await truncateTestDatabase();
});

afterEach(async () => {
  // Анализ дневника запускается fire-and-forget: не дождавшись его, следующий
  // кейс начал бы очистку БД посреди записи.
  await drainAiQueue();
});

describe('CJM: путь клиента от ссылки до рекомендации', () => {
  it('проводит клиента через ссылку, анкету, настройки, дневник и рекомендацию', async () => {
    const seeded = await seedInvitedClient();

    // 1. Активация ссылки-приглашения (ФТ-1, ФТ-2).
    const activation = await sendStart(`enr_${LINK_CODE}`);

    const link = await EnrollmentLink.findByPk(seeded.linkId);
    const client = await Client.findByPk(seeded.clientId);
    expect(link?.status).toBe('used');
    expect(link?.usedByTelegramId).toBe(TELEGRAM_ID.toString());
    expect(client?.telegramId).toBe(TELEGRAM_ID.toString());
    expect(client?.telegramUsername).toBe('cjm_client');
    await expect(
      EnrollmentLinkAttempt.count({ where: { linkId: seeded.linkId, result: 'success' } }),
    ).resolves.toBe(1);

    // 2. Анкета началась с первого вопроса, статус ушёл в in_progress (ФТ-2).
    expect((await reloadEnrollment(seeded.enrollmentId)).onboardingStatus).toBe('in_progress');
    expect(activation.replies.at(0)).toContain('вы подключены к курсу');
    expect(activation.replies.at(-1)).toContain('Вопрос 1 из 10');
    expect(activation.replies.at(-1)).toContain('Как к вам обращаться?');
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ telegramId: TELEGRAM_ID.toString(), type: 'info' }),
    );

    // 3. Прохождение анкеты: имя уходит в Client.firstName, ответы — в Questionnaire.
    await completeQuestionnaireFlow();

    const questionnaire = await loadQuestionnaire(seeded.enrollmentId);
    expect(questionnaire.status).toBe('completed');
    expect(questionnaire.currentQuestion).toBe(10);
    expect(questionnaire.answers).toMatchObject({
      name: 'Анна',
      age: { value: 'около 30', approximate: true },
      weight: { value: 68.5, approximate: false },
      goal: 'weight_loss',
      obstacles: ['no_time'],
      health: ['none'],
    });
    expect((await Client.findByPk(seeded.clientId))?.firstName).toBe('Анна');
    expect((await reloadEnrollment(seeded.enrollmentId)).onboardingStatus).toBe('settings_pending');

    // 4. Настройки уведомлений (ФТ-3): время → частота → типы → готово.
    await completeSettingsFlow();

    const settings = await NotificationSettings.findOne({ where: { clientId: seeded.clientId } });
    expect(settings?.reminderTime).toBe('09:00');
    expect(settings?.frequency).toBe('daily');
    expect(settings?.timezone).toBe(DEFAULT_TIMEZONE);
    expect((await reloadEnrollment(seeded.enrollmentId)).onboardingStatus).toBe('completed');

    // 5. Первая запись дневника (ФТ-5): время берётся из ключевого слова, калории — из текста.
    const diary = await sendText('на завтрак овсянка с бананом 350 ккал');

    const entries = await NutritionDiary.findAll({
      where: { clientEnrollmentId: seeded.enrollmentId },
    });
    const entry = entries[0];
    expect(entries).toHaveLength(1);
    expect(entry?.status).toBe('filled');
    expect(entry?.description).toBe('на завтрак овсянка с бананом');
    expect(entry?.approxCalories).toBe(350);
    expect(localTime(entry?.mealAt ?? new Date())).toBe('09:00');
    expect(diary.replies).toEqual([]);
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Спасибо, записал! 🍽️' }),
    );

    // 6. Рекомендация: анализ дневника доходит до строки Recommendation и отправки.
    await drainAiQueue();

    const recommendations = await Recommendation.findAll({
      where: { clientId: seeded.clientId },
    });
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.nutritionDiaryId).toBe(entry?.id);
    expect(recommendations[0]?.content).toBeTruthy();
    expect(recommendations[0]?.status).toBe('sent');
    // Сценарий длинный: 12 шагов анкеты и 3 шага настроек, каждый — несколько
    // запросов к удалённой тестовой БД.
  }, 180_000);
});

describe('активация ссылки-приглашения', () => {
  it('не пускает по уже использованной ссылке', async () => {
    const seeded = await seedInvitedClient({ linkStatus: 'used' });

    const fake = await sendStart(`enr_${LINK_CODE}`);

    expect(fake.replies.at(0)).toContain('уже была использована');
    expect((await Client.findByPk(seeded.clientId))?.telegramId).toBeNull();
    await expect(
      EnrollmentLinkAttempt.count({ where: { linkId: seeded.linkId, result: 'already_used' } }),
    ).resolves.toBe(1);
  });

  it('переводит истёкшую ссылку в expired и просит новую', async () => {
    const seeded = await seedInvitedClient({ linkExpiresAt: new Date(Date.now() - 60_000) });

    const fake = await sendStart(`enr_${LINK_CODE}`);

    expect(fake.replies.at(0)).toContain('истекла');
    expect((await EnrollmentLink.findByPk(seeded.linkId))?.status).toBe('expired');
    await expect(
      EnrollmentLinkAttempt.count({ where: { linkId: seeded.linkId, result: 'expired' } }),
    ).resolves.toBe(1);
  });

  it('логирует попытку с неизвестным кодом без привязки к ссылке', async () => {
    await seedInvitedClient();

    const fake = await sendStart('enr_notARealCode01');

    expect(fake.replies.at(0)).toContain('Такой ссылки не существует');
    await expect(
      EnrollmentLinkAttempt.count({ where: { linkId: null, result: 'invalid_code' } }),
    ).resolves.toBe(1);
  });

  it('не показывает отзыв ссылки: отозванная выглядит как несуществующая', async () => {
    const seeded = await seedInvitedClient({ linkStatus: 'revoked' });

    const fake = await sendStart(`enr_${LINK_CODE}`);

    expect(fake.replies.at(0)).toContain('Такой ссылки не существует');
    await expect(
      EnrollmentLinkAttempt.count({ where: { linkId: seeded.linkId, result: 'invalid_code' } }),
    ).resolves.toBe(1);
  });

  it('при продлении курса не запускает анкету заново (ФТ-18)', async () => {
    const seeded = await seedInvitedClient({ onboardingStatus: 'completed' });

    const fake = await sendStart(`enr_${LINK_CODE}`);

    expect(fake.replies[0]).toContain('С возвращением!');
    expect(fake.replies[1]).toContain('Краткая памятка');
    expect(fake.replies[1]).toContain('до 21:00');
    await expect(
      Questionnaire.count({ where: { clientEnrollmentId: seeded.enrollmentId } }),
    ).resolves.toBe(0);
    expect((await reloadEnrollment(seeded.enrollmentId)).onboardingStatus).toBe('completed');
  });

  it('без ссылки и без клиента объясняет, что нужна ссылка администратора', async () => {
    await seedInvitedClient();

    const fake = await sendStart('');

    expect(fake.replies.at(0)).toContain('персональная ссылка-приглашение');
  });

  it('повторный переход по своей ссылке продолжает анкету, а не начинает заново', async () => {
    await seedInvitedClient();
    await sendStart(`enr_${LINK_CODE}`);
    await sendText('Оля');
    vi.mocked(sendTelegramMessage).mockClear();

    const again = await sendStart(`enr_${LINK_CODE}`);

    expect(again.replies.some((text) => text.includes('уже была использована'))).toBe(false);
    expect(again.replies.some((text) => text.includes('вы подключены к курсу'))).toBe(false);
    expect(again.replies.at(-1)).toContain('Вопрос 2 из 10');
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    await expect(Questionnaire.count()).resolves.toBe(1);
    expect((await Questionnaire.findOne())?.currentQuestion).toBe(1);
  });

  it('повторный /start без ссылки продолжает с текущего вопроса', async () => {
    await seedInvitedClient();
    await sendStart(`enr_${LINK_CODE}`);
    await sendText('Оля');

    const again = await sendStart('');

    expect(again.replies.at(-1)).toContain('Вопрос 2 из 10');
    expect(again.replies.some((text) => text.includes('Привет снова'))).toBe(false);
    expect((await Questionnaire.findOne())?.currentQuestion).toBe(1);
  });

  it('после онбординга параллельный in_progress enrollment не перехватывает дневник', async () => {
    const seeded = await seedInvitedClient({
      onboardingStatus: 'completed',
      telegramId: TELEGRAM_ID.toString(),
      linkStatus: 'used',
      usedByTelegramId: TELEGRAM_ID.toString(),
    });
    await sendStart(`enr_${LINK_CODE}`);

    const extraCourse = await Course.create({
      name: 'Дубль курса',
      durationDays: 30,
      startDate: '2026-04-01',
      endDate: '2026-05-01',
    });
    const extraEnrollment = await ClientEnrollment.create({
      clientId: seeded.clientId,
      courseId: extraCourse.id,
      startDate: '2026-04-01',
      endDate: '2026-05-01',
      onboardingStatus: 'in_progress',
    });
    await Questionnaire.create({
      clientEnrollmentId: extraEnrollment.id,
      clientId: seeded.clientId,
      answers: {},
      currentQuestion: 0,
      status: 'in_progress',
    });

    const fake = await sendText('съела плитку молочной шоколадки, потому что стрессовала');

    expect(fake.replies.join('\n')).not.toContain('Вопрос');
    await expect(
      NutritionDiary.count({ where: { clientEnrollmentId: seeded.enrollmentId } }),
    ).resolves.toBe(1);
    await expect(
      NutritionDiary.count({ where: { clientEnrollmentId: extraEnrollment.id } }),
    ).resolves.toBe(0);
    expect(
      (await Questionnaire.findOne({ where: { clientEnrollmentId: extraEnrollment.id } }))
        ?.currentQuestion,
    ).toBe(0);
  });
});

describe('анкета', () => {
  beforeEach(async () => {
    await seedInvitedClient();
    await sendStart(`enr_${LINK_CODE}`);
  });

  it('на вопрос с кнопками не принимает текст и повторяет вопрос', async () => {
    await sendText('Анна');
    await sendText('30');
    await sendText('70');

    const fake = await sendText('хочу похудеть');

    const questionnaire = await loadQuestionnaire(
      (await Questionnaire.findOne())?.clientEnrollmentId ?? '',
    );
    expect(fake.replies.at(0)).toContain('выберите вариант из меню');
    expect(fake.replies.at(-1)).toContain('Вопрос 4 из 10');
    expect(questionnaire.currentQuestion).toBe(3);
    expect(questionnaire.answers).not.toHaveProperty('goal');
  });

  it('просит переписать пустой ответ, не двигая прогресс', async () => {
    const fake = await sendText('   ');

    // Пустой текст до сохранения имени: обработчик возвращает клиента к первому вопросу.
    expect(fake.replies.at(-1)).toContain('Вопрос 1 из 10');
    expect((await Questionnaire.findOne())?.currentQuestion).toBe(0);
  });

  it('после «Готово» с вариантом «Другое» ждёт свой текст и сохраняет его', async () => {
    await sendText('Анна');
    await sendText('30');
    await sendText('70');
    await pressButton('q:3:opt:0');

    // «Другое» в списке помех — последний вариант (индекс 6), он с free text.
    await pressButton('q:4:toggle:6');
    const done = await pressButton('q:4:done');
    const beforeText = await Questionnaire.findOne();
    const afterText = await sendText('ночные смены на работе');

    expect(done.replies.at(-1)).toContain('Напишите своими словами');
    expect(beforeText?.currentQuestion).toBe(4);
    expect((await Questionnaire.findOne())?.answers).toMatchObject({
      obstacles: { values: ['other'], freeText: 'ночные смены на работе' },
    });
    expect(afterText.replies.at(-1)).toContain('Вопрос 6 из 10');
  });

  it('не принимает «Готово» в мультивыборе без выбранных вариантов', async () => {
    await sendText('Анна');
    await sendText('30');
    await sendText('70');
    await pressButton('q:3:opt:0');

    const fake = await pressButton('q:4:done');

    expect(fake.callbackAnswers).toEqual([
      'Выберите хотя бы один вариант, затем нажмите «Готово».',
    ]);
    expect((await Questionnaire.findOne())?.currentQuestion).toBe(4);
  });

  it('игнорирует кнопку от уже пройденного вопроса', async () => {
    await sendText('Анна');

    const fake = await pressButton('q:0:opt:0');

    expect(fake.callbackAnswers).toEqual(['Этот вопрос уже пройден. Продолжаем с текущего.']);
    expect((await Questionnaire.findOne())?.currentQuestion).toBe(1);
  });
});

describe('настройки уведомлений', () => {
  let seeded: Seeded;

  beforeEach(async () => {
    seeded = await seedInvitedClient({ onboardingStatus: 'settings_pending' });
    await sendStart(`enr_${LINK_CODE}`);
  });

  it('не завершает визард, пока не выбран ни один тип уведомлений', async () => {
    await pressButton('settings:time:08:00');
    await pressButton('settings:freq:daily');
    // Гасим все четыре типа, включённых по умолчанию.
    await pressButton('settings:type:diary');
    await pressButton('settings:type:recommendations');
    await pressButton('settings:type:weekly_report');
    await pressButton('settings:type:evening_summary');

    const fake = await pressButton('settings:types_done');

    expect(fake.callbackAnswers).toEqual(['Выберите хотя бы один тип уведомлений.']);
    expect((await reloadEnrollment(seeded.enrollmentId)).onboardingStatus).toBe('settings_pending');
  });

  it('отклоняет время вне списка слотов', async () => {
    const fake = await pressButton('settings:time:03:17');

    expect(fake.callbackAnswers).toEqual(['Некорректное время напоминания.']);
    const settings = await NotificationSettings.findOne({ where: { clientId: seeded.clientId } });
    expect(settings?.reminderTime).toBe('09:00');
  });

  it('после завершения визарда присылает памятку о дневнике', async () => {
    await completeSettingsFlow();
    const fake = await pressButton('settings:types_done');

    // Визард уже закрыт: повторное «Готово» показывает сводку настроек, а не памятку.
    expect(fake.edits.at(-1)).toContain('Текущие настройки уведомлений');
    expect((await reloadEnrollment(seeded.enrollmentId)).onboardingStatus).toBe('completed');
  });

  it('до завершения настроек запись в дневник не создаётся', async () => {
    const fake = await sendText('съела салат');

    await expect(
      NutritionDiary.count({ where: { clientEnrollmentId: seeded.enrollmentId } }),
    ).resolves.toBe(0);
    expect(fake.replies.at(0)).toContain('настроим уведомления');
  });
});

describe('дневник питания', () => {
  let seeded: Seeded;

  beforeEach(async () => {
    seeded = await seedInvitedClient({ onboardingStatus: 'completed' });
    await sendStart(`enr_${LINK_CODE}`);
  });

  it('на мусорный текст просит уточнение и не считает запись заполненной', async () => {
    const fake = await sendText('...');

    const entry = await NutritionDiary.findOne({
      where: { clientEnrollmentId: seeded.enrollmentId },
    });
    expect(entry?.status).toBe('needs_clarification');
    expect(entry?.clarificationAttempts).toBe(1);
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Кажется, я не понял. Можете переформулировать?' }),
    );
    expect(fake.replies).toEqual([]);
  });

  it('дополняет незаполненную запись следующим сообщением', async () => {
    await sendText('...');

    await sendText('омлет из двух яиц');
    await drainAiQueue();

    const entries = await NutritionDiary.findAll({
      where: { clientEnrollmentId: seeded.enrollmentId },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('filled');
    expect(entries[0]?.description).toBe('омлет из двух яиц');
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Спасибо, уточнил! 🍽️' }),
    );
  });

  it('после трёх неудачных уточнений записывает как есть', async () => {
    await sendText('...');
    await sendText('!!');

    const fake = await sendText('?!');

    const entry = await NutritionDiary.findOne({
      where: { clientEnrollmentId: seeded.enrollmentId },
    });
    expect(entry?.clarificationAttempts).toBe(3);
    expect(entry?.status).toBe('needs_clarification');
    expect(vi.mocked(sendTelegramMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Записал как есть. Позже мы уточним детали.' }),
    );
    expect(fake.replies).toEqual([]);
  });

  it('берёт время приёма пищи из явного указания в тексте', async () => {
    await sendText('в 14:30 борщ с хлебом');
    await drainAiQueue();

    const entry = await NutritionDiary.findOne({
      where: { clientEnrollmentId: seeded.enrollmentId },
    });
    expect(localTime(entry?.mealAt ?? new Date())).toBe('14:30');
  });

  it('на каждую запись выпускает не больше одной рекомендации', async () => {
    await sendText('обед: паста карбонара');
    await sendText('перекус: печенье с чаем');
    await drainAiQueue();

    const entries = await NutritionDiary.count({
      where: { clientEnrollmentId: seeded.enrollmentId },
    });
    const recommendations = await Recommendation.findAll({ where: { clientId: seeded.clientId } });
    expect(entries).toBe(2);
    expect(recommendations).toHaveLength(2);
    expect(new Set(recommendations.map((item) => item.nutritionDiaryId)).size).toBe(2);
  });

  it('переиспользует настоящий processDiaryEntry, а не заглушку', async () => {
    await sendText('ужин: рыба с овощами');
    await drainAiQueue();

    const entry = await NutritionDiary.findOne({
      where: { clientEnrollmentId: seeded.enrollmentId },
    });
    expect(vi.mocked(processDiaryEntry)).toHaveBeenCalledWith(entry?.id);
    await expect(Recommendation.count({ where: { clientId: seeded.clientId } })).resolves.toBe(1);
  });
});
