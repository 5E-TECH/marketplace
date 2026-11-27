import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';
import {
  PRODUCT_ARCHIVE_RPC,
  ProductStatus,
  WHOLESALER_CABINET_RPC,
} from '@app/common';
import { ProductArchiveService } from './product-archive.service';

/** BE-25 (FE-25): mahsulotni arxivlash — qoidalar [taklif] (dizayn p-a2 4.4). */
describe('ProductArchiveService', () => {
  const setup = (
    product: Record<string, unknown> | null,
    opts: {
      held?: { onHand: number; reserved: number };
      open?: number;
      inventoryError?: boolean;
      checkoutError?: boolean;
      variants?: Array<{ id: string; sku: string }>;
    } = {},
  ) => {
    let current = product ? { ...product } : null;
    const repo = {
      findOne: jest.fn(async () => (current ? { ...current } : null)),
      save: jest.fn(async (p: Record<string, unknown>) => {
        current = { ...p };
        return current;
      }),
    };
    const products = {
      findOne: repo.findOne,
      manager: {
        transaction: jest.fn(async (fn: (m: unknown) => unknown) =>
          fn({ getRepository: () => repo }),
        ),
      },
    };
    const variants = {
      find: jest.fn(async () => opts.variants ?? [{ id: '100', sku: 'S-1' }]),
    };
    const productService = { publishRemoved: jest.fn(async () => undefined) };
    const inventory = {
      send: jest.fn(() =>
        opts.inventoryError
          ? throwError(() => new Error('inventory yo‘q'))
          : of({
              items: [],
              totals: { onHand: 0, reserved: 0, ...opts.held },
            }),
      ),
    };
    const checkout = {
      send: jest.fn(() =>
        opts.checkoutError
          ? throwError(() => new Error('checkout yo‘q'))
          : of(opts.open ? { '10': opts.open } : {}),
      ),
    };
    const service = new ProductArchiveService(
      products as never,
      variants as never,
      productService as never,
      inventory as never,
      checkout as never,
    );
    return { service, repo, productService, inventory, checkout };
  };
  const product = (over: Record<string, unknown> = {}) => ({
    id: '10',
    shopId: '7',
    name: 'Elektr choynak',
    status: ProductStatus.ACTIVE,
    isBlocked: true,
    isDeleted: false,
    ...over,
  });

  it('to‘xtatilgan, qoldiqsiz va ochiq buyurtmasiz — ARCHIVED, qidiruvdan chiqadi', async () => {
    const { service, repo, productService, inventory, checkout } =
      setup(product());
    await expect(service.archive('10')).resolves.toMatchObject({
      id: '10',
      status: ProductStatus.ARCHIVED,
    });
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(productService.publishRemoved).toHaveBeenCalledWith(
      expect.objectContaining({ id: '10', status: ProductStatus.ARCHIVED }),
    );
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: WHOLESALER_CABINET_RPC.STOCK_SUMMARY },
      {
        wholesalerId: '7',
        variants: [
          {
            productId: '10',
            productName: 'Elektr choynak',
            variantId: '100',
            sku: 'S-1',
          },
        ],
      },
    );
    expect(checkout.send).toHaveBeenCalledWith(
      { cmd: PRODUCT_ARCHIVE_RPC.OPEN_ORDERS },
      { productIds: ['10'] },
    );
  });

  it.each([
    ProductStatus.DRAFT,
    ProductStatus.PENDING_REVIEW,
    ProductStatus.REJECTED,
  ])('%s (sotuvda emas) — arxivlanadi', async (status) => {
    const { service } = setup(product({ status, isBlocked: false }));
    await expect(service.archive('10')).resolves.toMatchObject({
      status: ProductStatus.ARCHIVED,
    });
  });

  it('allaqachon arxivda yoki sotuvda (ACTIVE, to‘xtatilmagan) — 409, tekshiruvlarsiz', async () => {
    for (const p of [
      product({ status: ProductStatus.ARCHIVED }),
      product({ isBlocked: false }),
    ]) {
      const { service, repo, inventory } = setup(p);
      await expect(service.archive('10')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(inventory.send).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    }
  });

  it('omborda yoki bandda dona bor — 409 soni bilan', async () => {
    const { service, repo } = setup(product(), {
      held: { onHand: 2, reserved: 1 },
    });
    await expect(service.archive('10')).rejects.toThrow(
      'Omborda yoki buyurtmalarda 3 dona bor — arxivlab bo‘lmaydi',
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('ochiq buyurtma bor — 409 soni bilan', async () => {
    const { service, repo } = setup(product(), { open: 2 });
    await expect(service.archive('10')).rejects.toThrow(
      'Ochiq buyurtmasi bor (2 ta) — arxivlab bo‘lmaydi',
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('ombor yoki buyurtma xizmati javob bermasa — 503, arxivlanmaydi', async () => {
    for (const opts of [{ inventoryError: true }, { checkoutError: true }]) {
      const { service, repo } = setup(product(), opts);
      await expect(service.archive('10')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    }
  });

  it('variant yo‘q — ombor so‘ralmaydi, buyurtma tekshiriladi', async () => {
    const { service, inventory, checkout } = setup(product(), {
      variants: [],
    });
    await expect(service.archive('10')).resolves.toMatchObject({
      status: ProductStatus.ARCHIVED,
    });
    expect(inventory.send).not.toHaveBeenCalled();
    expect(checkout.send).toHaveBeenCalled();
  });

  it('topilmasa yoki ID noto‘g‘ri — 404', async () => {
    await expect(setup(null).service.archive('10')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      setup(product()).service.archive('abc'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
