// Unit-тесты для обработчика feedback (roadmap 7.13–7.14: skip, comment, повторный текст).
// Используем Vitest с ESM-моками для shared-модулей.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFeedbackComment } from './feedback-handler.js';
import type { BotContext } from '../context.js';

vi.mock('@nutrition-bot/shared', () => ({
  Feedback: { findOne: vi.fn() },
  Message: { create: vi.fn() },
  sendTelegramMessage: vi.fn(),
}));

import { Feedback, Message, sendTelegramMessage } from '@nutrition-bot/shared';

const mockedFindOne = vi.mocked(Feedback.findOne);
const mockedMessageCreate = vi.mocked(Message.create);
const mockedSendTelegramMessage = vi.mocked(sendTelegramMessage);

interface FakeFeedback {
  id: string;
  clientId: string;
  rating: number;
  comment: string | null;
  update: ReturnType<typeof vi.fn>;
}

function createMockContext(partial: Partial<BotContext> = {}): BotContext {
  return {
    client: undefined,
    ...partial,
  } as unknown as BotContext;
}

describe('handleFeedbackComment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when client is missing', async () => {
    const ctx = createMockContext();
    const result = await handleFeedbackComment(ctx, 'какой-то текст');
    expect(result).toBe(false);
    expect(mockedFindOne).not.toHaveBeenCalled();
  });

  it('returns false when no pending feedback exists', async () => {
    mockedFindOne.mockResolvedValue(null);
    const ctx = createMockContext({
      client: { id: 'client-1', telegramId: '123' } as unknown as BotContext['client'],
    });

    const result = await handleFeedbackComment(ctx, 'какой-то текст');
    expect(result).toBe(false);
  });

  it('saves comment and notifies admin for low rating', async () => {
    const feedback: FakeFeedback = {
      id: 'feedback-1',
      clientId: 'client-1',
      rating: 2,
      comment: null,
      update: vi.fn(),
    };
    mockedFindOne.mockResolvedValue(
      feedback as unknown as Awaited<ReturnType<typeof mockedFindOne>>,
    );

    const ctx = createMockContext({
      client: { id: 'client-1', telegramId: '123' } as unknown as BotContext['client'],
    });

    const result = await handleFeedbackComment(ctx, 'не хватало конкретики');
    expect(result).toBe(true);
    expect(feedback.update).toHaveBeenCalledWith({ comment: 'не хватало конкретики' });
    expect(mockedSendTelegramMessage).toHaveBeenCalledOnce();
    expect(mockedMessageCreate).toHaveBeenCalledOnce();
  });

  it('does not consume text after comment is already provided', async () => {
    const feedback: FakeFeedback = {
      id: 'feedback-1',
      clientId: 'client-1',
      rating: 2,
      comment: 'уже оставлен',
      update: vi.fn(),
    };
    mockedFindOne.mockResolvedValue(
      feedback as unknown as Awaited<ReturnType<typeof mockedFindOne>>,
    );

    const ctx = createMockContext({
      client: { id: 'client-1', telegramId: '123' } as unknown as BotContext['client'],
    });

    const result = await handleFeedbackComment(ctx, 'ещё текст');
    expect(result).toBe(false);
    expect(feedback.update).not.toHaveBeenCalled();
  });

  it('does not consume text for high rating', async () => {
    const feedback: FakeFeedback = {
      id: 'feedback-1',
      clientId: 'client-1',
      rating: 5,
      comment: null,
      update: vi.fn(),
    };
    mockedFindOne.mockResolvedValue(
      feedback as unknown as Awaited<ReturnType<typeof mockedFindOne>>,
    );

    const ctx = createMockContext({
      client: { id: 'client-1', telegramId: '123' } as unknown as BotContext['client'],
    });

    const result = await handleFeedbackComment(ctx, 'диетический текст');
    expect(result).toBe(false);
  });
});
