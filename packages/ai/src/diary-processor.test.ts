// Тесты обработки записи дневника с фейковым AIEngine (roadmap 13.4, ФТ-6, ФТ-7).
// Проверяется не качество советов, а дисциплина вокруг них: суточный лимит,
// один совет на запись, изоляция сбоя доставки и вечерняя сводка как побочный шаг.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Op } from 'sequelize';
import {
  makeClient,
  makeDiaryEntry,
  makeEnrollment,
  makeMessage,
  makeQuestionnaire,
  makeRecommendation,
} from '@nutrition-bot/shared/testing';

const { DAY_RANGE } = vi.hoisted(() => ({
  // Локальные сутки 15 января 2026 по Europe/Kaliningrad (UTC+2).
  DAY_RANGE: {
    start: new Date('2026-01-14T22:00:00.000Z'),
    end: new Date('2026-01-15T21:59:59.999Z'),
  },
}));

vi.mock('@nutrition-bot/shared', () => ({
  Client: { findByPk: vi.fn() },
  ClientEnrollment: { findByPk: vi.fn(), findOne: vi.fn() },
  DEFAULT_TIMEZONE: 'Europe/Kaliningrad',
  Message: { count: vi.fn() },
  NutritionDiary: { findByPk: vi.fn(), findAll: vi.fn() },
  Questionnaire: { findOne: vi.fn() },
  Recommendation: { create: vi.fn() },
  getZonedDayRange: vi.fn(() => DAY_RANGE),
  sendTelegramMessage: vi.fn(),
}));
vi.mock('./evening-summary.js', () => ({ maybeSendEveningSummaryIfDue: vi.fn() }));
vi.mock('./factory.js', () => ({ createAIEngine: vi.fn() }));
vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  Client,
  ClientEnrollment,
  Message,
  NutritionDiary,
  Questionnaire,
  Recommendation,
  getZonedDayRange,
  sendTelegramMessage,
} from '@nutrition-bot/shared';
import { processDiaryEntry } from './diary-processor.js';
import { maybeSendEveningSummaryIfDue } from './evening-summary.js';
import { createAIEngine } from './factory.js';
import { logger } from './logger.js';
import type { AIEngine, DiaryAnalysisInput, RecommendationProposal } from './types.js';

const RECOMMENDATION_TEXT = 'Добавь к обеду стакан воды — так проще держать норму.';

function proposal(overrides: Partial<RecommendationProposal> = {}): RecommendationProposal {
  return {
    id: 'proposal-1',
    criterion: 'water',
    type: 'habit',
    priority: 'medium',
    rationale: 'Воды в записи нет',
    draftText: 'Черновик про воду',
    ...overrides,
  };
}

function fakeEngine(proposals: RecommendationProposal[]): AIEngine {
  return {
    analyzeDiary: vi.fn().mockResolvedValue({ proposals, metadata: { engine: 'fake' } }),
    generateRecommendationText: vi.fn().mockResolvedValue(RECOMMENDATION_TEXT),
    generateEveningSummary: vi.fn(),
  };
}

interface ArrangeOptions {
  deliveredToday?: number;
  proposals?: RecommendationProposal[];
  client?: ReturnType<typeof makeClient>;
  enrollment?: ReturnType<typeof makeEnrollment>;
}

function arrange(options: ArrangeOptions = {}) {
  const entry = makeDiaryEntry();
  const client = options.client ?? makeClient();
  const enrollment = options.enrollment ?? makeEnrollment();
  const message = makeMessage({ type: 'recommendation' });
  const recommendation = makeRecommendation();
  const engine = fakeEngine(options.proposals ?? [proposal()]);

  vi.mocked(NutritionDiary.findByPk).mockResolvedValue(entry);
  vi.mocked(NutritionDiary.findAll).mockResolvedValue([entry]);
  vi.mocked(Client.findByPk).mockResolvedValue(client);
  vi.mocked(ClientEnrollment.findByPk).mockResolvedValue(enrollment);
  vi.mocked(ClientEnrollment.findOne).mockResolvedValue(null);
  vi.mocked(Questionnaire.findOne).mockResolvedValue(null);
  vi.mocked(Message.count).mockResolvedValue(options.deliveredToday ?? 0);
  vi.mocked(Recommendation.create).mockResolvedValue(recommendation);
  vi.mocked(sendTelegramMessage).mockResolvedValue({ telegramMessageId: 777, message });
  vi.mocked(createAIEngine).mockReturnValue(engine);
  vi.mocked(maybeSendEveningSummaryIfDue).mockResolvedValue({ sent: true, skipped: false });

  return { entry, client, enrollment, message, recommendation, engine };
}

/** Вход, с которым processDiaryEntry обратился к движку. */
function analysisInput(engine: AIEngine): DiaryAnalysisInput | undefined {
  return vi.mocked(engine.analyzeDiary).mock.calls[0]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processDiaryEntry — предварительные условия', () => {
  it('падает, если записи дневника нет', async () => {
    arrange();
    vi.mocked(NutritionDiary.findByPk).mockResolvedValue(null);

    await expect(processDiaryEntry('diary-missing')).rejects.toThrow('diary-missing');
    expect(createAIEngine).not.toHaveBeenCalled();
  });

  it('ничего не делает, если у клиента нет telegramId', async () => {
    arrange({ client: makeClient({ telegramId: null }) });

    const result = await processDiaryEntry('diary-1');

    expect(result).toEqual({ recommendationsCreated: 0, messagesSent: 0, skippedDueToLimit: 0 });
    expect(createAIEngine).not.toHaveBeenCalled();
    expect(maybeSendEveningSummaryIfDue).not.toHaveBeenCalled();
  });

  it('ничего не делает, если курс не активен', async () => {
    arrange({ enrollment: makeEnrollment({ status: 'paused' }) });

    const result = await processDiaryEntry('diary-1');

    expect(result).toEqual({ recommendationsCreated: 0, messagesSent: 0, skippedDueToLimit: 0 });
    expect(createAIEngine).not.toHaveBeenCalled();
    expect(maybeSendEveningSummaryIfDue).not.toHaveBeenCalled();
  });
});

describe('processDiaryEntry — суточный лимит', () => {
  it('считает лимит по доставленным сообщениям за локальные сутки клиента', async () => {
    arrange();

    await processDiaryEntry('diary-1');

    expect(getZonedDayRange).toHaveBeenCalledWith(expect.any(Date), 'Europe/Kaliningrad');
    expect(Message.count).toHaveBeenCalledWith({
      where: {
        clientId: 'client-1',
        type: 'recommendation',
        deliveryStatus: 'sent',
        createdAt: { [Op.between]: [DAY_RANGE.start, DAY_RANGE.end] },
      },
    });
  });

  it('не обращается к модели, когда 3 рекомендации за день уже доставлены', async () => {
    const { engine } = arrange({ deliveredToday: 3 });

    const result = await processDiaryEntry('diary-1');

    expect(engine.analyzeDiary).not.toHaveBeenCalled();
    expect(Recommendation.create).not.toHaveBeenCalled();
    expect(result).toEqual({ recommendationsCreated: 0, messagesSent: 0, skippedDueToLimit: 0 });
  });

  it('всё равно проверяет вечернюю сводку при исчерпанном лимите', async () => {
    const { client, enrollment } = arrange({ deliveredToday: 3 });

    await processDiaryEntry('diary-1');

    expect(maybeSendEveningSummaryIfDue).toHaveBeenCalledWith({
      client,
      enrollmentId: enrollment.id,
      timezone: 'Europe/Kaliningrad',
    });
  });

  it('отправляет не больше одной рекомендации на запись, остальные считает пропущенными', async () => {
    arrange({
      proposals: [
        proposal({ id: 'proposal-low', priority: 'low' }),
        proposal({ id: 'proposal-high', priority: 'high' }),
      ],
    });

    const result = await processDiaryEntry('diary-1');

    expect(result).toEqual({ recommendationsCreated: 1, messagesSent: 1, skippedDueToLimit: 1 });
    expect(Recommendation.create).toHaveBeenCalledTimes(1);
  });

  it('выбирает предложение с более высоким приоритетом', async () => {
    const { engine } = arrange({
      proposals: [
        proposal({ id: 'proposal-low', priority: 'low', type: 'habit' }),
        proposal({ id: 'proposal-critical', priority: 'critical', type: 'calories' }),
      ],
    });

    await processDiaryEntry('diary-1');

    expect(engine.generateRecommendationText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(engine.generateRecommendationText).mock.calls[0]?.[0].id).toBe(
      'proposal-critical',
    );
    expect(Recommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'critical', type: 'calories' }),
    );
  });

  it('пропускает предложения, когда свободен только один слот из трёх', async () => {
    arrange({
      deliveredToday: 2,
      proposals: [proposal({ id: 'proposal-1' }), proposal({ id: 'proposal-2' })],
    });

    const result = await processDiaryEntry('diary-1');

    expect(result).toEqual({ recommendationsCreated: 1, messagesSent: 1, skippedDueToLimit: 1 });
  });
});

describe('processDiaryEntry — создание и доставка рекомендации', () => {
  it('сохраняет текст от модели и связывает сообщение с рекомендацией', async () => {
    const { message, recommendation } = arrange();

    const result = await processDiaryEntry('diary-1');

    expect(Recommendation.create).toHaveBeenCalledWith({
      clientId: 'client-1',
      nutritionDiaryId: 'diary-1',
      questionnaireId: null,
      type: 'habit',
      priority: 'medium',
      content: RECOMMENDATION_TEXT,
      status: 'sent',
    });
    expect(sendTelegramMessage).toHaveBeenCalledWith({
      telegramId: '100200300',
      text: RECOMMENDATION_TEXT,
      clientId: 'client-1',
      type: 'recommendation',
      category: 'optional',
    });
    expect(message.update).toHaveBeenCalledWith({ recommendationId: recommendation.id });
    expect(result).toEqual({ recommendationsCreated: 1, messagesSent: 1, skippedDueToLimit: 0 });
  });

  it('передаёт модели историю курса, анкету и контекст клиента', async () => {
    const questionnaire = makeQuestionnaire({ status: 'completed' });
    const previousEntry = makeDiaryEntry({ id: 'diary-previous' });
    const { entry, engine } = arrange();
    vi.mocked(Questionnaire.findOne).mockResolvedValue(questionnaire);
    vi.mocked(ClientEnrollment.findOne).mockResolvedValue(makeEnrollment({ id: 'enrollment-old' }));
    vi.mocked(NutritionDiary.findAll)
      .mockResolvedValueOnce([entry])
      .mockResolvedValueOnce([previousEntry]);

    await processDiaryEntry('diary-1');

    expect(analysisInput(engine)).toMatchObject({
      entry,
      history: [entry],
      previousHistory: [previousEntry],
      questionnaire,
      clientContext: { firstName: 'Анна', timezone: 'Europe/Kaliningrad' },
    });
  });

  it('не ищет предыдущий курс, если завершённых курсов нет', async () => {
    const { engine } = arrange();

    await processDiaryEntry('diary-1');

    expect(analysisInput(engine)?.previousHistory).toEqual([]);
  });

  it('не глушит ошибку модели: обработка падает без записи рекомендации', async () => {
    const { engine } = arrange();
    vi.mocked(engine.analyzeDiary).mockRejectedValue(new Error('AI недоступен'));

    await expect(processDiaryEntry('diary-1')).rejects.toThrow('AI недоступен');
    expect(Recommendation.create).not.toHaveBeenCalled();
  });

  it('при сбое доставки сохраняет рекомендацию и доходит до вечерней сводки', async () => {
    arrange();
    vi.mocked(sendTelegramMessage).mockRejectedValue(new Error('Telegram недоступен'));

    const result = await processDiaryEntry('diary-1');

    expect(result).toMatchObject({ recommendationsCreated: 1, messagesSent: 0 });
    expect(Recommendation.create).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
    expect(maybeSendEveningSummaryIfDue).toHaveBeenCalled();
  });
});

describe('processDiaryEntry — вечерняя сводка', () => {
  it('сбой сводки не отменяет уже отправленную рекомендацию', async () => {
    arrange();
    vi.mocked(maybeSendEveningSummaryIfDue).mockRejectedValue(new Error('Сводка не собралась'));

    const result = await processDiaryEntry('diary-1');

    expect(result).toMatchObject({ recommendationsCreated: 1, messagesSent: 1 });
    expect(logger.error).toHaveBeenCalled();
  });
});
