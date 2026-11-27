import { ProductStatus } from '@app/common';
import { ProductUpsellService } from './product-upsell.service';

/** BE-45: upsell juftligi qoidalari (repozitoriy — namuna). */
describe('ProductUpsellService.setPair', () => {
  const product = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    status: ProductStatus.ACTIVE,
    cpaEnabled: true,
    isDeleted: false,
    upsellProductId: null as string | null,
    ...over,
  });
  const setup = (rows: Record<string, ReturnType<typeof product>>) => {
    const repo = {
      findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) =>
        rows[id] ? { ...rows[id] } : null,
      ),
      update: jest.fn(
        async ({ id }: { id: string }, patch: Record<string, unknown>) => {
          Object.assign(rows[id], patch);
        },
      ),
    };
    return { service: new ProductUpsellService(repo as never), repo, rows };
  };

  it('juftlik qo‘yiladi va olib tashlanadi', async () => {
    const { service, rows } = setup({ '1': product('1'), '2': product('2') });
    await expect(service.setPair('1', '2')).resolves.toMatchObject({
      upsellProductId: '2',
    });
    expect(rows['1'].upsellProductId).toBe('2');
    await expect(service.setPair('1', null)).resolves.toMatchObject({
      upsellProductId: null,
    });
  });

  it('o‘zi bilan — 400; topilmasa — 404; arxivdagi, rad etilgan yoki CPA o‘chirilgan — 409', async () => {
    const { service, repo } = setup({
      '1': product('1'),
      '3': product('3', { status: ProductStatus.ARCHIVED }),
      '4': product('4', { status: ProductStatus.REJECTED }),
      '5': product('5', { cpaEnabled: false }),
    });
    await expect(service.setPair('1', '1')).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.setPair('1', '9')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.setPair('9', '1')).rejects.toMatchObject({
      status: 404,
    });
    for (const id of ['3', '4', '5'])
      await expect(service.setPair('1', id)).rejects.toMatchObject({
        status: 409,
      });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
