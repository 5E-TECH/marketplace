import { of, throwError } from 'rxjs';
import { CheckoutDeliveryDestination } from '@app/common';
import { LeadCardService } from './lead-card.service';

/** BE-25 (FE-09): operator formasidagi summa izohi — katalogdan; katalog javob bermasa maydonlar null. */
describe('LeadCardService: narx obyekti', () => {
  const service = (send: jest.Mock, catalog: unknown = {}) =>
    new LeadCardService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      catalog as never,
      { send } as never,
      {} as never,
    );
  const lead = { productId: '501', salePrice: '262000' };

  it('rejim, og‘irlik, ikkala yetkazish turi va formula', async () => {
    const quote = {
      deliveryFee: 34_000,
      elchiTariff: 44_000,
      deliveryMode: 'PARTIAL',
      weightGrams: 3_600,
      deliveryOptions: { CENTER: 34_000, ADDRESS: 54_000 },
      deliveryFormula: {
        base: 30_000,
        extraKg: 1,
        perExtraKg: 4_000,
        baseWeightGrams: 3_000,
      },
    };
    const price = await service(jest.fn(() => of(quote))).price(
      lead,
      null,
      8,
      CheckoutDeliveryDestination.CENTER,
    );
    expect(price).toEqual({
      unitPrice: 262_000,
      quantity: 8,
      subtotal: 2_096_000,
      whereDeliver: 'CENTER',
      deliveryFee: 34_000,
      totalAmount: 2_130_000,
      deliveryMode: 'PARTIAL',
      weightGrams: 3_600,
      deliveryOptions: quote.deliveryOptions,
      deliveryFormula: quote.deliveryFormula,
    });
  });

  it('katalog javob bermadi: bir dona — sahifadagi yetkazish, izohsiz; ko‘p dona — summa yo‘q', async () => {
    const down = service(jest.fn(() => throwError(() => new Error('yo‘q'))));
    const offer = { centerDeliveryFee: 30_000, addressDeliveryFee: 50_000 };
    await expect(
      down.price(lead, offer as never, 1, CheckoutDeliveryDestination.ADDRESS),
    ).resolves.toMatchObject({
      deliveryFee: 50_000,
      deliveryMode: null,
      weightGrams: null,
      deliveryOptions: null,
      deliveryFormula: null,
    });
    await expect(
      down.price(lead, offer as never, 2, CheckoutDeliveryDestination.ADDRESS),
    ).resolves.toBeNull();
  });

  it('ko‘p tovarli posilka: rejim va jami og‘irlik; formula yo‘q', async () => {
    const orderSnapshotMany = jest.fn(async () => ({
      items: [{ weightGrams: 300 }, { weightGrams: 1_000 }],
      delivery: { mode: 'SEPARATE', shown: 40_000, elchiTariff: 40_000 },
    }));
    const price = await service(jest.fn(), { orderSnapshotMany }).parcelPrice(
      [
        { productId: '1', quantity: 2, unitPrice: 100_000 },
        { productId: '2', quantity: 1, unitPrice: 50_000 },
      ],
      CheckoutDeliveryDestination.CENTER,
    );
    expect(price).toMatchObject({
      totalAmount: 290_000,
      deliveryMode: 'SEPARATE',
      weightGrams: 1_600,
      deliveryOptions: null,
      deliveryFormula: null,
    });
  });
});
