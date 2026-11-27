import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminProductsQueryDto } from './admin-shop.dto';

/** BE-25 (FE-12): mahsulotlar ro‘yxati filtrlari — ID lar bigint chegarasida (bazaga yetib 500 bermasin). */
describe('AdminProductsQueryDto', () => {
  const errors = async (query: Record<string, unknown>) =>
    (
      await validate(plainToInstance(AdminProductsQueryDto, query) as object, {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).map((e) => e.property);

  it('categoryId va shopId: musbat bigint; katta, harfli, ro‘yxat — xato', async () => {
    for (const field of ['categoryId', 'shopId']) {
      expect(await errors({ [field]: '3' })).toEqual([]);
      for (const bad of ['9223372036854775808', 'abc', '0', ['1', '2']])
        expect(await errors({ [field]: bad })).toEqual([field]);
    }
  });

  it('cpaEnabled — `true`/`false` matni boolean ga; attention — faqat ikki qiymat', async () => {
    expect(
      plainToInstance(AdminProductsQueryDto, { cpaEnabled: 'false' })
        .cpaEnabled,
    ).toBe(false);
    expect(await errors({ cpaEnabled: 'ha' })).toEqual(['cpaEnabled']);
    expect(await errors({ attention: 'OUT_OF_STOCK' })).toEqual([]);
    expect(await errors({ attention: 'OTHER' })).toEqual(['attention']);
  });
});
