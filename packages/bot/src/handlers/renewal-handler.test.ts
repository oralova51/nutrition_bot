// Unit-тесты для обработчика callback продления курса (roadmap 8.2).

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { handleRenewalCallback } from './renewal-handler.js';
import type { BotContext } from '../context.js';
import type { CallbackQueryContext } from 'grammy';

vi.mock('@nutrition-bot/shared', () => ({
  RenewalOffer: { findByPk: vi.fn() },
  resolveRenewalConfig: vi.fn(() => ({ checkoutUrl: 'https://checkout.example.com' })),
  sendTelegramMessage: vi.fn(),
}));

import { RenewalOffer, resolveRenewalConfig, sendTelegramMessage } from '@nutrition-bot/shared';

const mockedFindByPk = vi.mocked(RenewalOffer.findByPk);
const mockedResolveRenewalConfig = vi.mocked(resolveRenewalConfig);
const mockedSendTelegramMessage = vi.mocked(sendTelegramMessage);

interface FakeOffer {
  id: string;
  clientId: string;
  status: string;
  checkoutUrl: string;
  update: Mock<(args: { status: string; clickedAt?: Date }) => Promise<unknown>>;
}

function createMockCallbackContext(
  partial: Partial<CallbackQueryContext<BotContext>> = {},
): CallbackQueryContext<BotContext> {
  return {
    client: { id: 'client-1', telegramId: '123' } as unknown as BotContext['client'],
    callbackQuery: {
      data: 'renewal:accept:offer-1',
    } as unknown as CallbackQueryContext<BotContext>['callbackQuery'],
    editMessageText: vi.fn(),
    answerCallbackQuery: vi.fn(),
    ...partial,
  } as unknown as CallbackQueryContext<BotContext>;
}

describe('handleRenewalCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when client is missing', async () => {
    const ctx = createMockCallbackContext({ client: undefined });
    await handleRenewalCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: 'Не удалось определить клиента.',
    });
  });

  it('rejects when offer belongs to another client', async () => {
    const offer: FakeOffer = {
      id: 'offer-1',
      clientId: 'other-client',
      status: 'sent',
      checkoutUrl: 'https://checkout.example.com/offer',
      update: vi.fn(),
    };
    mockedFindByPk.mockResolvedValue(
      offer as unknown as Awaited<ReturnType<typeof mockedFindByPk>>,
    );

    const ctx = createMockCallbackContext();
    await handleRenewalCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: 'Предложение не найдено или уже обработано.',
    });
  });

  it('rejects when offer is already clicked', async () => {
    const offer: FakeOffer = {
      id: 'offer-1',
      clientId: 'client-1',
      status: 'clicked',
      checkoutUrl: 'https://checkout.example.com/offer',
      update: vi.fn(),
    };
    mockedFindByPk.mockResolvedValue(
      offer as unknown as Awaited<ReturnType<typeof mockedFindByPk>>,
    );

    const ctx = createMockCallbackContext();
    await handleRenewalCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: 'Предложение не найдено или уже обработано.',
    });
  });

  it('updates status only after successful delivery', async () => {
    const offer: FakeOffer = {
      id: 'offer-1',
      clientId: 'client-1',
      status: 'sent',
      checkoutUrl: 'https://checkout.example.com/offer',
      update: vi.fn(),
    };
    mockedFindByPk.mockResolvedValue(
      offer as unknown as Awaited<ReturnType<typeof mockedFindByPk>>,
    );

    const ctx = createMockCallbackContext();
    await handleRenewalCallback(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledOnce();
    expect(mockedSendTelegramMessage).toHaveBeenCalledOnce();

    const updateMock = vi.mocked(offer.update);
    expect(updateMock).toHaveBeenCalledOnce();
    const updateArg = updateMock.mock.calls[0]?.[0];
    expect(updateArg).toMatchObject({ status: 'clicked' });
    expect(updateArg?.clickedAt).toBeInstanceOf(Date);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Спасибо! Ссылка отправлена.' });
    expect(mockedResolveRenewalConfig).not.toHaveBeenCalled();
  });

  it('does not update status when delivery fails', async () => {
    const offer: FakeOffer = {
      id: 'offer-1',
      clientId: 'client-1',
      status: 'sent',
      checkoutUrl: 'https://checkout.example.com/offer',
      update: vi.fn(),
    };
    mockedFindByPk.mockResolvedValue(
      offer as unknown as Awaited<ReturnType<typeof mockedFindByPk>>,
    );

    const ctx = createMockCallbackContext();
    ctx.editMessageText = vi.fn().mockRejectedValue(new Error('Telegram error'));

    await expect(handleRenewalCallback(ctx)).rejects.toThrow('Telegram error');
    expect(offer.update).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: 'Не удалось отправить ссылку. Попробуйте позже.',
    });
  });
});
