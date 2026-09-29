import { of } from 'rxjs';
import { BadRequestException } from '@nestjs/common';
import { ReturnReason, ReturnRequestStatus } from '@app/common';
import { ReturnRefundService } from './return-refund.service';

describe('ReturnRefundService (C4.2)', () => {
  function setup(
    target: Record<string, unknown> = {},
    paymentResult: Record<string, unknown> = {},
  ) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('FOR UPDATE OF r')) {
          return [
            {
              id: '3',
              status: ReturnRequestStatus.APPROVED,
              reason: ReturnReason.CHANGED_MIND,
              requestedAmount: 200000,
              orderId: '10',
              sellerOrderId: '51',
              shopId: '7',
              customerId: '5',
              orderStatus: 'CONFIRMED',
              paymentMethod: 'online',
              paymentId: '90',
              ...target,
            },
          ];
        }
        if (sql.includes('FROM checkout.return_request_item ri')) {
          return [{ variantId: '12', quantity: 2 }];
        }
        return [];
      }),
    };
    const dataSource = { transaction: jest.fn((run) => run(manager)) };
    const queries = { get: jest.fn(async (id: string) => ({ id })) };
    const notifier = { notify: jest.fn() };
    const payment = {
      send: jest.fn((_pattern, data: { amount: number }) =>
        of({ status: 'PAID', amount: data.amount, ...paymentResult }),
      ),
    };
    const inventory = { send: jest.fn(() => of({ operation: 'INBOUND' })) };
    const finance = { send: jest.fn(() => of({ idempotent: false })) };
    const service = new ReturnRefundService(
      dataSource as never,
      queries as never,
      notifier as never,
      payment as never,
      inventory as never,
      finance as never,
    );
    const sqls = (fragment: string) =>
      calls.filter((call) => call.sql.includes(fragment));
    return { service, payment, inventory, finance, notifier, sqls };
  }

  const admin = { id: '1', role: 'SUPERADMIN' };

  it('TC2: online qisman refund — provayder, ombor, ledger va so‘rov bir oqimda', async () => {
    const { service, payment, inventory, finance, notifier, sqls } = setup();

    await service.refund({ returnId: '3', actor: admin, amount: 150000 });

    expect(payment.send).toHaveBeenCalledWith(
      { cmd: 'payment.refund' },
      expect.objectContaining({
        paymentId: '90',
        salesOrderId: '10',
        amount: 150000,
        idempotencyKey: 'return-refund:3',
      }),
    );
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: 'inventory.return-order-items' },
      expect.objectContaining({
        orderRef: '10',
        items: [{ variantId: '12', quantity: 2 }],
        idempotencyKey: 'return-refund:3',
      }),
    );
    expect(finance.send).toHaveBeenCalledWith(
      { cmd: 'finance.refund' },
      expect.objectContaining({
        sellerOrderId: '51',
        shopId: '7',
        amount: 150000,
        returnRequestId: '3',
      }),
    );
    expect(sqls('SET status=$2,refunded_amount=$3')[0].params).toEqual([
      '3',
      ReturnRequestStatus.REFUNDED,
      150000,
      true,
      '1',
    ]);
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ReturnRequestStatus.REFUNDED,
        amount: 150000,
      }),
      { customerId: '5', shopId: '7' },
    );
  });

  it('summa berilmasa so‘rovdagi tovarlar summasi to‘liq qaytariladi', async () => {
    const { service, payment } = setup();
    await service.refund({ returnId: '3', actor: admin });
    expect(payment.send).toHaveBeenCalledWith(
      { cmd: 'payment.refund' },
      expect.objectContaining({ amount: 200000 }),
    );
  });

  it('brak tovar default holatda omborga qaytmaydi', async () => {
    const { service, inventory, sqls } = setup({
      reason: ReturnReason.DEFECTIVE,
    });
    await service.refund({ returnId: '3', actor: admin });
    expect(inventory.send).not.toHaveBeenCalled();
    expect(sqls('SET status=$2,refunded_amount=$3')[0].params[3]).toBe(false);
  });

  it('COD: provayderga so‘rov yo‘q, izoh majburiy, sotuvchi ledgeridan yechiladi', async () => {
    const { service, payment, finance } = setup({ paymentMethod: 'cod' });
    await expect(
      service.refund({ returnId: '3', actor: admin }),
    ).rejects.toThrow('izohda');
    expect(finance.send).not.toHaveBeenCalled();

    await service.refund({
      returnId: '3',
      actor: admin,
      comment: 'Karta orqali qaytarildi',
    });
    expect(payment.send).not.toHaveBeenCalled();
    expect(finance.send).toHaveBeenCalledWith(
      { cmd: 'finance.refund' },
      expect.objectContaining({ amount: 200000 }),
    );
  });

  it('takroriy chaqiruvda provayder qaytargan haqiqiy summa yoziladi', async () => {
    const { service, finance } = setup({}, { amount: 120000 });
    await service.refund({ returnId: '3', actor: admin, amount: 150000 });
    expect(finance.send).toHaveBeenCalledWith(
      { cmd: 'finance.refund' },
      expect.objectContaining({ amount: 120000 }),
    );
  });

  it('allaqachon REFUNDED — hech qanday yon ta’sir yo‘q', async () => {
    const { service, payment, inventory, finance, notifier } = setup({
      status: ReturnRequestStatus.REFUNDED,
    });
    await expect(
      service.refund({ returnId: '3', actor: admin }),
    ).resolves.toEqual({ id: '3' });
    expect(payment.send).not.toHaveBeenCalled();
    expect(inventory.send).not.toHaveBeenCalled();
    expect(finance.send).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('tasdiqlanmagan so‘rov, ortiq summa yoki to‘liq qaytarilgan buyurtma rad etiladi', async () => {
    await expect(
      setup({ status: ReturnRequestStatus.IN_REVIEW }).service.refund({
        returnId: '3',
        actor: admin,
      }),
    ).rejects.toThrow('APPROVED');
    await expect(
      setup().service.refund({ returnId: '3', actor: admin, amount: 250000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup({ orderStatus: 'REFUNDED' }).service.refund({
        returnId: '3',
        actor: admin,
      }),
    ).rejects.toThrow('to‘liq qaytarilgan');
  });
});
