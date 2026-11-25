import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminProductsController } from './admin-products.controller';
import { AdminWholesalersController } from './admin-wholesalers.controller';

const user = (role: Role) => ({ sub: '61', role }) as never;
const full = {
  items: [
    {
      id: '15',
      name: 'Gadget Trade MChJ',
      status: 'ACTIVE',
      tin: '305123456',
      contractNumber: 'K-12',
      contractDate: '2026-11-01',
      bankName: 'Kapitalbank',
      bankAccount: '20208000900123456001',
      bankMfo: '01158',
      phone: '+998901234567',
      ownerUserId: '77',
    },
  ],
  total: 1,
  page: 1,
  limit: 100,
  totalPages: 1,
};
const product = {
  id: '42',
  shopId: '15',
  shop: { id: '15', name: 'Gadget Trade MChJ' },
  name: 'Vitamin D3',
  status: 'ACTIVE',
  cpaEnabled: true,
  isBad: true,
  isBlocked: false,
  expiryTracked: true,
  weightGrams: 150,
  basePrice: 140000,
  approvedPrice: 262000,
  affiliateFee: 65000,
  price: 262000,
  marketTotal: 300000,
};

/** BE-25 (FE-16, OMB-1): omborchi optovik va mahsulotni tanlaydi, lekin narx va rekvizitlarni ko‘rmaydi (TZ 3). */
describe('Omborchi ko‘rinishi: optoviklar va mahsulotlar', () => {
  it('ro‘yxatlar omborchiga ochiq; karta, yaratish va tahrirlash — faqat admin va superadmin', () => {
    const staff = [Role.ADMIN, Role.WAREHOUSE, Role.SUPERADMIN];
    for (const type of [AdminWholesalersController, AdminProductsController]) {
      expect(Reflect.getMetadata(ROLES_KEY, type)).toEqual([
        Role.ADMIN,
        Role.SUPERADMIN,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, type.prototype.list)).toEqual(
        staff,
      );
      for (const name of Object.getOwnPropertyNames(type.prototype))
        if (!['constructor', 'list', 'audit'].includes(name))
          expect(
            Reflect.getMetadata(
              ROLES_KEY,
              (type.prototype as unknown as Record<string, object>)[name],
            ),
          ).toBeUndefined();
    }
  });

  it('optoviklar: omborchiga nom, holat, STIR va shartnoma; adminga hammasi', async () => {
    const controller = new AdminWholesalersController(
      { send: () => of(full) } as never,
      {} as never,
    );
    await expect(
      controller.list({} as never, user(Role.WAREHOUSE)),
    ).resolves.toEqual({
      ...full,
      items: [
        {
          id: '15',
          name: 'Gadget Trade MChJ',
          status: 'ACTIVE',
          tin: '305123456',
          contractNumber: 'K-12',
          contractDate: '2026-11-01',
        },
      ],
    });
    await expect(
      controller.list({} as never, user(Role.ADMIN)),
    ).resolves.toEqual(full);
    await expect(
      controller.list({} as never, user(Role.SUPERADMIN)),
    ).resolves.toEqual(full);
  });

  it('mahsulotlar: omborchiga narx va sotuvchi haqi chiqmaydi', async () => {
    const page = { items: [product], total: 1, page: 1, limit: 100 };
    const send = jest.fn(() => of(page));
    const controller = new AdminProductsController(
      { send } as never,
      {} as never,
      {} as never,
    );
    const query = { shopId: '15', page: 1, limit: 100 } as never;
    const view = await controller.list(query, user(Role.WAREHOUSE));
    expect(view).toEqual({
      ...page,
      items: [
        {
          id: '42',
          shopId: '15',
          name: 'Vitamin D3',
          status: 'ACTIVE',
          cpaEnabled: true,
          isBad: true,
          isBlocked: false,
          expiryTracked: true,
          weightGrams: 150,
        },
      ],
    });
    expect(send).toHaveBeenCalledWith(
      { cmd: 'catalog.product.admin-list' },
      { query },
    );
    await expect(controller.list(query, user(Role.ADMIN))).resolves.toEqual(
      page,
    );
  });
});
