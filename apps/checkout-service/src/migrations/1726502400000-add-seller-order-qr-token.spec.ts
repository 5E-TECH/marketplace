import { AddSellerOrderQrToken1726502400000 } from './1726502400000-add-seller-order-qr-token';

describe('AddSellerOrderQrToken1726502400000', () => {
  it('sales_order_seller ga qr_code_token ustunini qo‘shadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddSellerOrderQrToken1726502400000().up({ query } as never);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('qr_code_token'),
    );
  });

  it('down ustunni olib tashlaydi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddSellerOrderQrToken1726502400000().down({ query } as never);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DROP COLUMN IF EXISTS "qr_code_token"'),
    );
  });
});
