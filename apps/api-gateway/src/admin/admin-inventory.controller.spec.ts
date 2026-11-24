import { of, throwError } from 'rxjs';
import {
  CATALOG_DISPLAY_LOOKUP,
  IDENTITY_USER_NAMES,
  INBOUND_RPC,
  Role,
  ROLES_KEY,
} from '@app/common';
import { AdminInventoryController } from './admin-inventory.controller';

describe('AdminInventoryController (C6.7)', () => {
  it('TC1/TC2: ADMIN/SUPERADMIN global stock va movement RPCni chaqiradi', async () => {
    // BE-05: qoldiqni omborchi ham ko‘radi (TZ 3-bo‘lim)
    expect(Reflect.getMetadata(ROLES_KEY, AdminInventoryController)).toEqual([
      Role.ADMIN,
      Role.WAREHOUSE,
      Role.SUPERADMIN,
    ]);
    const send = jest.fn(() => of({ items: [], total: 0 }));
    const controller = new AdminInventoryController(
      { send } as never,
      { send: jest.fn() } as never,
      { send: jest.fn() } as never,
    );
    await controller.stock({ page: 1, limit: 20, lowOnly: false });
    await controller.movements({ page: 1, limit: 20 });
    expect(send).toHaveBeenNthCalledWith(
      1,
      { cmd: 'inventory.admin.stock-list' },
      { query: { page: 1, limit: 20, lowOnly: false } },
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      { cmd: 'inventory.admin.movements-list' },
      { query: { page: 1, limit: 20 } },
    );
  });
});

/** BE-25 (FE-16): postavkada optovik nomi, kim kiritgani va qabul qilgani, «muddat kuzatiladi» belgisi. */
describe('AdminInventoryController: postavka nomlari (BE-25)', () => {
  const shipment = (over: Record<string, unknown> = {}) => ({
    id: '14',
    wholesalerId: '15',
    declaredBy: '3',
    receivedBy: null,
    items: [{ id: '7', productId: '42' }],
    ...over,
  });
  const setup = (answers: {
    inventory?: unknown;
    catalog?: () => unknown;
    identity?: () => unknown;
  }) => {
    const inventory = jest.fn(() => of(answers.inventory));
    const catalog = jest.fn(
      answers.catalog ??
        (() =>
          of({
            shops: [{ id: '15', name: 'Gadget Trade MChJ' }],
            products: [{ id: '42', imageUrl: null, expiryTracked: true }],
            variants: [],
          })),
    );
    const identity = jest.fn(
      answers.identity ??
        (() =>
          of([
            { id: '3', name: 'Nodira K.', role: Role.ADMIN },
            { id: '5', name: 'Jasur T.', role: Role.WAREHOUSE },
          ])),
    );
    return {
      controller: new AdminInventoryController(
        { send: inventory } as never,
        { send: identity } as never,
        { send: catalog } as never,
      ),
      inventory,
      catalog,
      identity,
    };
  };

  it('ro‘yxat: nomlar bitta so‘rovda, takroriy ID lar bir marta; sanoq va filtrlar o‘zgarmaydi', async () => {
    const page = {
      items: [shipment(), shipment({ id: '13', receivedBy: '5' })],
      total: 2,
      page: 1,
      limit: 20,
      counts: { DECLARED: 1, IN_TRANSIT: 0, RECEIVED: 1, DISCREPANCY: 0 },
    };
    const { controller, inventory, catalog, identity } = setup({
      inventory: page,
    });
    const query = { search: 'vitamin', expectedFrom: '2026-12-01' } as never;
    const result = await controller.shipments(query);
    expect(inventory).toHaveBeenCalledWith({ cmd: INBOUND_RPC.LIST }, query);
    expect(result).toMatchObject({ total: 2, counts: page.counts });
    expect(result.items[0]).toMatchObject({
      wholesalerName: 'Gadget Trade MChJ',
      declaredByName: 'Nodira K.',
      declaredByRole: Role.ADMIN,
      receivedByName: null,
      items: [{ id: '7', productId: '42', expiryTracked: true }],
    });
    expect(result.items[1].receivedByName).toBe('Jasur T.');
    expect(catalog).toHaveBeenCalledTimes(1);
    expect(catalog).toHaveBeenCalledWith(
      { cmd: CATALOG_DISPLAY_LOOKUP },
      { shopIds: ['15'], productIds: ['42'] },
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: IDENTITY_USER_NAMES },
      { ids: ['3', '5'] },
    );
  });

  it('katalog va identity javob bermasa ham postavka qaytadi — nomlar null', async () => {
    const { controller } = setup({
      inventory: shipment({ receivedBy: '5' }),
      catalog: () => throwError(() => new Error('katalog yo‘q')),
      identity: () => throwError(() => new Error('identity yo‘q')),
    });
    await expect(controller.shipment('14')).resolves.toMatchObject({
      id: '14',
      wholesalerName: null,
      declaredByName: null,
      declaredByRole: null,
      receivedByName: null,
      items: [{ expiryTracked: null }],
    });
  });

  it('partiyalarda optovik nomi; bo‘sh ro‘yxatda katalogga so‘rov yo‘q', async () => {
    const lots = setup({
      inventory: [{ id: '31', wholesalerId: '15', notifiedAt: null }],
    });
    await expect(lots.controller.lots({} as never)).resolves.toEqual([
      {
        id: '31',
        wholesalerId: '15',
        notifiedAt: null,
        wholesalerName: 'Gadget Trade MChJ',
      },
    ]);
    const empty = setup({ inventory: [] });
    await expect(empty.controller.lots({} as never)).resolves.toEqual([]);
    expect(empty.catalog).not.toHaveBeenCalled();
  });
});
