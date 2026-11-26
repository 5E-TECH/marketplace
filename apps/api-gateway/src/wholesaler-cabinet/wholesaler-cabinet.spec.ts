import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { Role, ShopStatus } from '@app/common';
import { safeFileName, SignedFilesController } from './signed-files.controller';
import { SignedLinkService } from './signed-link';
import { WholesalerCabinetController } from './wholesaler-cabinet.controller';
import { WholesalerShipmentsController } from './wholesaler-shipments.controller';

const links = () =>
  new SignedLinkService(
    new ConfigService({ JWT_SECRET: 'test-secret-0123456789abcdef' }),
  );
const tokenOf = (url: string) => url.split('/').pop()!;
const user = { sub: '501', role: Role.WHOLESALER } as never;

describe('BE-30 TC4: imzolangan havola', () => {
  it('to‘g‘ri imzo va muddat ichida — hujjat; imzosiz, buzilgan, boshqa kalit yoki muddati o‘tgan — null', () => {
    const svc = links();
    const now = Date.parse('2026-12-01T09:00:00Z');
    const link = svc.sign({ t: 'doc', id: '7' }, now);
    expect(link.url).toMatch(/^\/api\/v1\/signed-files\/[\w-]+\.[\w-]+$/);
    expect(link.expiresAt).toBe('2026-12-01T09:10:00.000Z');
    const token = tokenOf(link.url);
    expect(svc.verify(token, now)).toEqual({ t: 'doc', id: '7' });
    const [payload, signature] = token.split('.');
    expect(svc.verify(payload, now)).toBeNull(); // imzosiz
    expect(svc.verify(`${payload}.${signature.slice(1)}x`, now)).toBeNull();
    // payload almashtirilgan (boshqa hujjat) — imzo mos emas
    const forged = Buffer.from(
      JSON.stringify({ t: 'doc', id: '8', e: 9_999_999_999 }),
    ).toString('base64url');
    expect(svc.verify(`${forged}.${signature}`, now)).toBeNull();
    expect(svc.verify(token, now + 601_000)).toBeNull(); // 10 daqiqadan keyin
    // boshqa sir bilan imzolangan
    const other = new SignedLinkService(
      new ConfigService({ JWT_SECRET: 'boshqa-sir-0123456789abcdef' }),
    );
    expect(other.verify(token, now)).toBeNull();
  });

  it('FILE_LINK_SECRET berilsa — shu bilan; JWT bilan imzolangan havola o‘tmaydi', () => {
    const own = new SignedLinkService(
      new ConfigService({
        JWT_SECRET: 'test-secret-0123456789abcdef',
        FILE_LINK_SECRET: 'alohida-sir',
      }),
    );
    const token = tokenOf(links().sign({ t: 'contract', w: '15' }).url);
    expect(own.verify(token)).toBeNull();
    expect(
      own.verify(tokenOf(own.sign({ t: 'contract', w: '15' }).url)),
    ).toEqual({
      t: 'contract',
      w: '15',
    });
  });

  it('controller: imzosiz havola — 403, fayl o‘qilmaydi; to‘g‘ri havola — hujjat keshlanmasdan', async () => {
    const svc = links();
    const catalog = {
      send: jest.fn(() =>
        of({
          id: '7',
          wholesalerId: '15',
          objectKey: 'private/wholesaler/15/0f0e.pdf',
          fileName: 'Guvohnoma №1.pdf',
        }),
      ),
    };
    const files = {
      send: jest.fn(() =>
        of({
          contentType: 'application/pdf',
          base64: Buffer.from('%PDF-1.7').toString('base64'),
        }),
      ),
    };
    const checkout = {
      send: jest.fn(() =>
        of({ id: '9', objectKey: 'private/returns/3/0f0e.webp' }),
      ),
    };
    const controller = new SignedFilesController(
      catalog as never,
      {} as never,
      files as never,
      checkout as never,
      svc,
    );
    const res = { setHeader: jest.fn() };
    await expect(
      controller.get('bad.token', res as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(files.send).not.toHaveBeenCalled();
    const file = await controller.get(
      tokenOf(svc.sign({ t: 'doc', id: '7' }).url),
      res as never,
    );
    expect(file.getHeaders()).toMatchObject({
      type: 'application/pdf',
      disposition: 'attachment; filename="Guvohnoma_No1.pdf"',
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(files.send).toHaveBeenCalledWith(
      { cmd: 'file.private.get' },
      { objectKey: 'private/wholesaler/15/0f0e.pdf' },
    );
    // BE-25: qaytarish rasmi — shu havola turi bilan, kaliti checkout’dan
    files.send.mockReturnValueOnce(
      of({
        contentType: 'image/webp',
        base64: Buffer.from('RIFF').toString('base64'),
      }),
    );
    const photo = await controller.get(
      tokenOf(svc.sign({ t: 'return-photo', id: '9' }).url),
      res as never,
    );
    expect(checkout.send).toHaveBeenCalledWith(
      { cmd: 'checkout.admin.return-photo-get' },
      { photoId: '9' },
    );
    expect(files.send).toHaveBeenLastCalledWith(
      { cmd: 'file.private.get' },
      { objectKey: 'private/returns/3/0f0e.webp' },
    );
    expect(photo.getHeaders()).toMatchObject({
      type: 'image/webp',
      disposition: 'attachment; filename="qaytarish-rasm-9.webp"',
    });
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
  });
});

describe('BE-30 postavka: faqat o‘z postavkasi, e’lon — faqat tasdiqlangan optovik', () => {
  const profile = (status: ShopStatus) => ({ id: '15', status });
  const make = (
    status: ShopStatus,
    shipmentOwner = '15',
    productStatus = 'ACTIVE',
  ) => {
    const catalog = {
      send: jest.fn((pattern: { cmd: string }) =>
        of(
          pattern.cmd === 'catalog.wholesaler.product.get'
            ? { status: productStatus, name: 'Termos' }
            : profile(status),
        ),
      ),
    };
    const inventory = {
      send: jest.fn((pattern: { cmd: string }, data: Record<string, unknown>) =>
        of(
          pattern.cmd === 'inventory.inbound.declare'
            ? { id: '9', wholesalerId: data.wholesalerId, status: 'DECLARED' }
            : { id: '9', wholesalerId: shipmentOwner, status: 'RECEIVED' },
        ),
      ),
    };
    const identity = { send: jest.fn(() => of(undefined)) };
    return {
      controller: new WholesalerShipmentsController(
        catalog as never,
        inventory as never,
        identity as never,
      ),
      inventory,
    };
  };

  it('TC5: optovik o‘z arizasini yubordi — optovik ID JWT dan, so‘rovdagi e’tiborsiz', async () => {
    const { controller, inventory } = make(ShopStatus.ACTIVE);
    await expect(
      controller.declare(
        {
          expectedAt: '2026-12-02',
          items: [{ productId: '42', quantity: 10 }],
          wholesalerId: '16',
        } as never,
        user,
        '10.0.0.1',
      ),
    ).resolves.toMatchObject({ status: 'DECLARED', wholesalerId: '15' });
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: 'inventory.inbound.declare' },
      expect.objectContaining({ wholesalerId: '15', actorId: '501' }),
    );
  });

  it('tasdiqlanmagan mahsulotga postavka — 400, ombor so‘rovi yo‘q', async () => {
    const { controller, inventory } = make(
      ShopStatus.ACTIVE,
      '15',
      'PENDING_REVIEW',
    );
    await expect(
      controller.declare(
        {
          expectedAt: '2026-12-02',
          items: [{ productId: '42', quantity: 10 }],
        } as never,
        user,
        '',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inventory.send).not.toHaveBeenCalled();
  });

  it('tasdiqlanmagan optovik e’lon qila olmaydi — 403; boshqa optovik postavkasi — 403', async () => {
    await expect(
      make(ShopStatus.PENDING).controller.declare(
        { expectedAt: '2026-12-02', items: [] } as never,
        user,
        '',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      make(ShopStatus.ACTIVE, '16').controller.get('9', user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      make(ShopStatus.ACTIVE, '15').controller.get('9', user),
    ).resolves.toMatchObject({ id: '9' });
  });
});

describe('BE-30 ro‘yxatni yakunlash (POST /wholesaler/profile)', () => {
  const make = (status: ShopStatus | null, tinFree = true) => {
    const catalog = {
      send: jest.fn((pattern: { cmd: string }) => {
        if (pattern.cmd === 'catalog.wholesaler.me')
          return status
            ? of({ id: '15', status })
            : throwError(() => new NotFoundException('yo‘q'));
        if (pattern.cmd === 'catalog.wholesaler.tin-free')
          return of({ free: tinFree });
        return of({ id: '15', status: ShopStatus.PENDING });
      }),
    };
    const identity = {
      send: jest.fn((pattern: { cmd: string }) =>
        of(
          pattern.cmd === 'auth.me'
            ? { phone: '+998901110015' }
            : { contractVersion: '1.1', consentVersion: '1.1' },
        ),
      ),
    };
    return {
      controller: new WholesalerCabinetController(
        catalog as never,
        identity as never,
        {} as never,
        {} as never,
        {} as never,
        links(),
      ),
      catalog,
    };
  };
  const dto = {
    name: 'Termos Savdo',
    legalType: 'LEGAL_ENTITY',
    tin: '305999001',
    bankName: 'Ipotekabank',
    bankAccount: '20208000900999000001',
    bankMfo: '00873',
    contractVersion: '1.1',
    consentVersion: '1.1',
  } as never;
  const selfRegisterCalls = (catalog: { send: jest.Mock }) =>
    catalog.send.mock.calls.filter(
      ([pattern]) => pattern.cmd === 'catalog.wholesaler.self-register',
    );

  it('rad etilgan ariza qayta yuboriladi (catalog ga); PENDING yoki faol — o‘sha yozuv, o‘zgarmaydi', async () => {
    const rejected = make(ShopStatus.REJECTED);
    await rejected.controller.complete(dto, user, '10.0.0.1');
    expect(selfRegisterCalls(rejected.catalog)).toEqual([
      [
        { cmd: 'catalog.wholesaler.self-register' },
        expect.objectContaining({
          ownerUserId: '501',
          phone: '+998901110015',
          contractVersion: '1.1',
        }),
      ],
    ]);
    for (const status of [ShopStatus.PENDING, ShopStatus.ACTIVE]) {
      const other = make(status);
      await expect(
        other.controller.complete(dto, user, ''),
      ).resolves.toMatchObject({ status });
      expect(selfRegisterCalls(other.catalog)).toEqual([]);
    }
  });

  it('yozuv yo‘q, STIR band — 409', async () => {
    const taken = make(null, false);
    await expect(
      taken.controller.complete(dto, user, ''),
    ).rejects.toMatchObject({ status: 409 });
    expect(selfRegisterCalls(taken.catalog)).toEqual([]);
  });
});

describe('BE-30 panel (QA 2026-11-23): «sotilgan» moliyadan', () => {
  it('moliyadagi sotilgan dona ombor hisobiga beriladi; optovik ID JWT dan', async () => {
    const variants = [
      { productId: '48', productName: 'Kofe', variantId: '848', sku: 'K-1' },
    ];
    const sold = [{ productId: '48', quantity: 1 }];
    const money = { held: 140000, payable: 0, paid: 0 };
    const stock = { items: [{ variantId: '848', sold: 1 }], totals: {} };
    const catalog = {
      send: jest.fn((pattern: { cmd: string }) =>
        of(
          pattern.cmd === 'catalog.wholesaler.me'
            ? { id: '15', status: ShopStatus.ACTIVE }
            : variants,
        ),
      ),
    };
    const finance = {
      send: jest.fn((pattern: { cmd: string }) =>
        of(pattern.cmd === 'finance.wholesaler.sold-units' ? sold : money),
      ),
    };
    const inventory = { send: jest.fn(() => of(stock)) };
    const controller = new WholesalerCabinetController(
      catalog as never,
      {} as never,
      inventory as never,
      finance as never,
      {} as never,
      links(),
    );
    await expect(controller.dashboard(user)).resolves.toEqual({
      stock: stock.items,
      stockTotals: stock.totals,
      money,
    });
    expect(finance.send).toHaveBeenCalledWith(
      { cmd: 'finance.wholesaler.sold-units' },
      { wholesalerId: '15' },
    );
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: 'inventory.wholesaler.summary' },
      { wholesalerId: '15', variants, sold },
    );
  });
});
