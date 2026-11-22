import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { Role, ShopStatus } from '@app/common';
import { safeFileName, SignedFilesController } from './signed-files.controller';
import { SignedLinkService } from './signed-link';
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
    const controller = new SignedFilesController(
      catalog as never,
      {} as never,
      files as never,
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
