import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ReturnReason, ReturnRequestStatus } from '@app/common';
import { ReturnRequestService } from './return-request.service';

const DAY = 24 * 60 * 60 * 1000;

interface ItemRow {
  orderItemId: string;
  sellerOrderId: string;
  shopId: string;
  sellerOrderStatus: string;
  quantity: number;
  unitPrice: number;
  deliveredAt: Date | null;
  sellerOrderUpdatedAt: Date;
  reservedQuantity: number;
}

function item(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    orderItemId: '31',
    sellerOrderId: '51',
    shopId: '7',
    sellerOrderStatus: 'DELIVERED',
    quantity: 2,
    unitPrice: 100000,
    deliveredAt: new Date(Date.now() - 2 * DAY),
    sellerOrderUpdatedAt: new Date(),
    reservedQuantity: 0,
    ...overrides,
  };
}

describe('ReturnRequestService (C4.2)', () => {
  function setup(
    options: {
      order?: { customerId: string; status: string } | null;
      items?: ItemRow[];
      request?: Record<string, string> | null;
      conflicts?: unknown[];
    } = {},
  ) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    let nextId = 100;
    const manager = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('FROM checkout.sales_order WHERE id=$1')) {
          return options.order === null
            ? []
            : [options.order ?? { customerId: '5', status: 'CONFIRMED' }];
        }
        if (sql.includes('FROM checkout.sales_order_item i')) {
          return options.items ?? [item()];
        }
        if (sql.includes('INSERT INTO checkout.return_request_item')) return [];
        if (sql.includes('INSERT INTO checkout.return_request_history')) {
          return [];
        }
        if (sql.includes('INSERT INTO checkout.return_request')) {
          return [{ id: String(nextId++) }];
        }
        if (sql.includes('FROM checkout.return_request WHERE id=$1')) {
          return options.request === null
            ? []
            : [
                {
                  id: '3',
                  status: ReturnRequestStatus.SUBMITTED,
                  shopId: '7',
                  customerId: '5',
                  orderId: '10',
                  ...options.request,
                },
              ];
        }
        if (sql.includes('ri.quantity > i.quantity')) {
          return options.conflicts ?? [];
        }
        return [];
      }),
    };
    const dataSource = { transaction: jest.fn((run) => run(manager)) };
    const queries = {
      findMany: jest.fn(async (_manager: unknown, ids: string[]) =>
        ids.map((id, index) => ({
          id,
          orderId: '10',
          shopId: index === 0 ? '7' : '8',
        })),
      ),
      get: jest.fn(async (id: string) => ({ id, history: [] })),
    };
    const notifier = { notify: jest.fn() };
    const config = { get: jest.fn(() => 10) };
    const service = new ReturnRequestService(
      dataSource as never,
      config as never,
      queries as never,
      notifier as never,
    );
    const sqls = (fragment: string) =>
      calls.filter((call) => call.sql.includes(fragment));
    return { service, dataSource, queries, notifier, sqls };
  }

  const create = (
    service: ReturnRequestService,
    dto: Partial<{
      items: Array<{ orderItemId: string; quantity: number }>;
      reason: ReturnReason;
      comment: string;
    }> = {},
    customerId = '5',
  ) =>
    service.create({
      orderId: '10',
      customerId,
      dto: {
        items: [{ orderItemId: '31', quantity: 1 }],
        reason: ReturnReason.CHANGED_MIND,
        ...dto,
      },
    });

  describe('create', () => {
    it('TC1: ikki do‘kon tovari ikki alohida so‘rovga bo‘linadi va sotuvchilar xabar oladi', async () => {
      const { service, notifier, sqls } = setup({
        items: [
          item(),
          item({
            orderItemId: '32',
            sellerOrderId: '52',
            shopId: '8',
            quantity: 1,
            unitPrice: 50000,
          }),
        ],
      });

      const result = await create(service, {
        items: [
          { orderItemId: '31', quantity: 1 },
          { orderItemId: '32', quantity: 1 },
        ],
      });

      expect(result.items).toHaveLength(2);
      const inserts = sqls('INSERT INTO checkout.return_request\n');
      expect(inserts.map((call) => call.params)).toEqual([
        ['10', '51', '7', '5', 'SUBMITTED', 'CHANGED_MIND', null, 100000],
        ['10', '52', '8', '5', 'SUBMITTED', 'CHANGED_MIND', null, 50000],
      ]);
      expect(sqls('INSERT INTO checkout.return_request_history')).toHaveLength(
        2,
      );
      expect(notifier.notify).toHaveBeenCalledTimes(2);
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ status: ReturnRequestStatus.SUBMITTED }),
        { shopId: '8' },
      );
    });

    it('yetkazilmagan posilkadagi tovar qaytarilmaydi', async () => {
      const { service } = setup({
        items: [item({ sellerOrderStatus: 'ON_THE_ROAD' })],
      });
      await expect(create(service)).rejects.toThrow('Faqat yetkazib berilgan');
    });

    it('muddat (10 kun) o‘tgan bo‘lsa rad etiladi', async () => {
      const { service } = setup({
        items: [item({ deliveredAt: new Date(Date.now() - 11 * DAY) })],
      });
      await expect(create(service)).rejects.toThrow('10 kun');
    });

    it('DELIVERED tarixi yo‘q eski posilkada oxirgi o‘zgarish sanasi olinadi', async () => {
      const { service } = setup({
        items: [
          item({
            deliveredAt: null,
            sellerOrderUpdatedAt: new Date(Date.now() - 3 * DAY),
          }),
        ],
      });
      await expect(create(service)).resolves.toMatchObject({
        items: [{ id: '100' }],
      });
    });

    it('boshqa so‘rovda band qilingan miqdordan ortig‘i qaytarilmaydi', async () => {
      const { service } = setup({ items: [item({ reservedQuantity: 2 })] });
      await expect(create(service)).rejects.toThrow('ko‘pi bilan 0 dona');
    });

    it('buyurtmaga tegishli bo‘lmagan tovar rad etiladi', async () => {
      const { service } = setup({ items: [] });
      await expect(create(service)).rejects.toThrow(
        '#31 tovar bu buyurtmaga tegishli emas',
      );
    });

    it('begona xaridor buyurtmasi — 403', async () => {
      const { service } = setup();
      await expect(create(service, {}, '999')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('bekor qilingan buyurtma qaytarilmaydi', async () => {
      const { service } = setup({
        order: { customerId: '5', status: 'CANCELLED' },
      });
      await expect(create(service)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('OTHER sababida izoh majburiy, takroriy tovar rad etiladi', async () => {
      const { service, dataSource } = setup();
      await expect(
        create(service, { reason: ReturnReason.OTHER }),
      ).rejects.toThrow('izoh');
      await expect(
        create(service, {
          items: [
            { orderItemId: '31', quantity: 1 },
            { orderItemId: '31', quantity: 1 },
          ],
        }),
      ).rejects.toThrow('ikki marta');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('transition', () => {
    const actor = { id: '70', role: 'SELLER' };

    it('TC1: sotuvchi tasdiqlaydi — qaror yoziladi, tarixga tushadi, xaridor xabar oladi', async () => {
      const { service, notifier, queries, sqls } = setup();

      await service.transition('sellerApprove', {
        returnId: '3',
        actor,
        shopId: '7',
        comment: 'Tovar tekshirildi',
      });

      expect(sqls('FROM checkout.return_request WHERE id=$1')[0]).toMatchObject(
        { params: ['3', '7'] },
      );
      expect(sqls('decision_comment=$3')[0].params).toEqual([
        '3',
        ReturnRequestStatus.APPROVED,
        'Tovar tekshirildi',
        '70',
      ]);
      expect(
        sqls('INSERT INTO checkout.return_request_history')[0].params,
      ).toEqual([
        '3',
        ReturnRequestStatus.SUBMITTED,
        ReturnRequestStatus.APPROVED,
        '70',
        'SELLER',
        'Tovar tekshirildi',
      ]);
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ status: ReturnRequestStatus.APPROVED }),
        { customerId: '5' },
      );
      expect(queries.get).toHaveBeenCalledWith('3', { shopId: '7' });
    });

    it('sotuvchi rad etilgan so‘rovni qayta tasdiqlay olmaydi', async () => {
      const { service } = setup({
        request: { status: ReturnRequestStatus.REJECTED },
      });
      await expect(
        service.transition('sellerApprove', {
          returnId: '3',
          actor,
          shopId: '7',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('bir xil holatga takroriy o‘tish yon ta’sirsiz', async () => {
      const { service, notifier, sqls } = setup({
        request: { status: ReturnRequestStatus.APPROVED },
      });
      await service.transition('sellerApprove', {
        returnId: '3',
        actor,
        shopId: '7',
      });
      expect(sqls('UPDATE checkout.return_request')).toHaveLength(0);
      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('rad etish sababi majburiy', async () => {
      const { service, dataSource } = setup();
      await expect(
        service.transition('sellerReject', {
          returnId: '3',
          actor,
          shopId: '7',
          comment: '  ',
        }),
      ).rejects.toThrow('sababini');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('admin rad etilganni tasdiqlaydi — tovar boshqa so‘rovda band bo‘lsa 409', async () => {
      const { service } = setup({
        request: { status: ReturnRequestStatus.REJECTED },
        conflicts: [{ orderItemId: '31' }],
      });
      await expect(
        service.transition('adminApprove', {
          returnId: '3',
          actor: { id: '1', role: 'ADMIN' },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('admin sotuvchi qarorini o‘zgartirsa xaridor ham, sotuvchi ham xabar oladi', async () => {
      const { service, notifier } = setup({
        request: { status: ReturnRequestStatus.REJECTED },
      });
      await service.transition('adminApprove', {
        returnId: '3',
        actor: { id: '1', role: 'ADMIN' },
      });
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ status: ReturnRequestStatus.APPROVED }),
        { customerId: '5', shopId: '7' },
      );
    });

    it('boshqa do‘kon so‘rovi yoki noto‘g‘ri id — 404', async () => {
      const { service } = setup({ request: null });
      await expect(
        service.transition('review', { returnId: '3', actor, shopId: '8' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.transition('review', { returnId: 'abc', actor, shopId: '8' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
