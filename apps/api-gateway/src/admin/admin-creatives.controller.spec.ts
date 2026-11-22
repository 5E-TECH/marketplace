import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { CREATIVE_RPC, CreativeType, Role, ROLES_KEY } from '@app/common';
import { AdminCreativesController } from './admin-creatives.controller';

describe('AdminCreativesController (BE-08)', () => {
  const admin = { sub: '7' } as never;
  const uploadKey =
    'creative-uploads/12/7b0c3e1a-1111-4222-8333-944455556666.mp4';
  const finalKey = 'creatives/12/7b0c3e1a-1111-4222-8333-944455556666.mp4';
  const file = {
    objectKey: finalKey,
    url: `https://api.elchi.test/media/m/${finalKey}`,
    type: CreativeType.VIDEO,
    mimeType: 'video/mp4',
    size: 80 * 1024 * 1024,
  };

  const make = (catalog: Record<string, () => unknown>) => {
    const catalogClient = {
      send: jest.fn(({ cmd }: { cmd: string }) =>
        catalog[cmd] ? catalog[cmd]() : of(null),
      ),
    };
    const files = {
      send: jest.fn(({ cmd }: { cmd: string }) =>
        of(
          cmd === CREATIVE_RPC.VERIFY
            ? file
            : cmd === CREATIVE_RPC.UPLOAD_POLICY
              ? { objectKey: uploadKey }
              : { removed: true },
        ),
      ),
    };
    const identity = { send: jest.fn(() => of(null)) };
    return {
      catalog: catalogClient,
      files,
      identity,
      controller: new AdminCreativesController(
        catalogClient as never,
        files as never,
        identity as never,
      ),
    };
  };
  const notFound = () => of({ creative: null });
  const removed = (files: { send: jest.Mock }) =>
    files.send.mock.calls.some(
      ([pattern]) => pattern.cmd === CREATIVE_RPC.REMOVE,
    );

  it('faqat ADMIN va SUPERADMIN (sotuvchi yuklamaydi — moderatsiya yo‘q)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminCreativesController)).toEqual([
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
  });

  it('yuklash: 20 kreativ bor — 409, policy berilmaydi (100 MB yuklangandan keyin emas)', async () => {
    const { controller, files } = make({
      [CREATIVE_RPC.LIST]: () => of(Array.from({ length: 20 }, () => ({}))),
    });
    await expect(
      controller.uploadPolicy('12', {
        type: CreativeType.VIDEO,
        contentType: 'video/mp4',
        size: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(files.send).not.toHaveBeenCalled();
  });

  it('tasdiq: fayl tekshiriladi (yuklama kaliti), kreativ yakuniy kalit bilan yoziladi va audit', async () => {
    const { controller, files, catalog, identity } = make({
      [CREATIVE_RPC.FIND]: notFound,
      [CREATIVE_RPC.CREATE]: () =>
        of({ id: '31', type: 'VIDEO', size: file.size }),
    });
    await expect(
      controller.confirm('12', { objectKey: uploadKey }, admin, '1.2.3.4'),
    ).resolves.toMatchObject({ id: '31' });
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: CREATIVE_RPC.FIND },
      { productId: '12', objectKey: finalKey },
    );
    expect(files.send).toHaveBeenCalledWith(
      { cmd: CREATIVE_RPC.VERIFY },
      { productId: '12', objectKey: uploadKey },
    );
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: CREATIVE_RPC.CREATE },
      { productId: '12', file, actorId: '7' },
    );
    expect(identity.send).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'creative.create', entityId: '31' }),
    );
  });

  it('takroriy tasdiq: kreativ bor — o‘sha qaytadi, fayl qayta tekshirilmaydi va o‘chirilmaydi', async () => {
    const { controller, files } = make({
      [CREATIVE_RPC.FIND]: () => of({ creative: { id: '31' } }),
    });
    await expect(
      controller.confirm('12', { objectKey: uploadKey }, admin, '1.2.3.4'),
    ).resolves.toEqual({ id: '31' });
    expect(files.send).not.toHaveBeenCalled();
  });

  it('kreativ aniq yozilmadi (chegara, 409) — fayl o‘chiriladi, xato qaytadi', async () => {
    const { controller, files } = make({
      [CREATIVE_RPC.FIND]: notFound,
      [CREATIVE_RPC.CREATE]: () =>
        throwError(() => new ConflictException('20 tadan oshmaydi')),
    });
    await expect(
      controller.confirm('12', { objectKey: uploadKey }, admin, '1.2.3.4'),
    ).rejects.toBeDefined();
    expect(files.send).toHaveBeenCalledWith(
      { cmd: CREATIVE_RPC.REMOVE },
      { objectKey: finalKey },
    );
  });

  it('catalog javobi kelmadi (504) yoki ichki xato — fayl qoladi (kreativ yozilgan bo‘lishi mumkin)', async () => {
    for (const status of [
      HttpStatus.GATEWAY_TIMEOUT,
      HttpStatus.INTERNAL_SERVER_ERROR,
    ]) {
      const { controller, files } = make({
        [CREATIVE_RPC.FIND]: notFound,
        [CREATIVE_RPC.CREATE]: () =>
          throwError(() => new HttpException('x', status)),
      });
      await expect(
        controller.confirm('12', { objectKey: uploadKey }, admin, '1.2.3.4'),
      ).rejects.toBeDefined();
      expect(removed(files)).toBe(false);
    }
  });

  it('o‘chirish: kreativ, keyin fayl', async () => {
    const { controller, files } = make({
      [CREATIVE_RPC.DELETE]: () => of({ id: '31', objectKey: finalKey }),
    });
    await expect(
      controller.remove('12', '31', admin, '1.2.3.4'),
    ).resolves.toEqual({ id: '31' });
    expect(files.send).toHaveBeenCalledWith(
      { cmd: CREATIVE_RPC.REMOVE },
      { objectKey: finalKey },
    );
  });
});
