import { ConflictException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { CREATIVE_RPC, CreativeType, Role, ROLES_KEY } from '@app/common';
import { AdminCreativesController } from './admin-creatives.controller';

describe('AdminCreativesController (BE-08)', () => {
  const admin = { sub: '7' } as never;
  const file = {
    objectKey: 'creatives/12/7b0c3e1a-1111-4222-8333-944455556666.mp4',
    url: 'https://api.elchi.test/media/m/creatives/12/7b0c3e1a-1111-4222-8333-944455556666.mp4',
    type: CreativeType.VIDEO,
    mimeType: 'video/mp4',
    size: 80 * 1024 * 1024,
  };

  const make = (catalogReply: (cmd: string) => unknown) => {
    const catalog = { send: jest.fn(({ cmd }) => catalogReply(cmd)) };
    const files = {
      send: jest.fn(({ cmd }) =>
        of(cmd === CREATIVE_RPC.VERIFY ? file : { removed: true }),
      ),
    };
    const identity = { send: jest.fn(() => of(null)) };
    return {
      catalog,
      files,
      identity,
      controller: new AdminCreativesController(
        catalog as never,
        files as never,
        identity as never,
      ),
    };
  };

  it('faqat ADMIN va SUPERADMIN (sotuvchi yuklamaydi — moderatsiya yo‘q)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminCreativesController)).toEqual([
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
  });

  it('tasdiq: fayl tekshiriladi, kreativ yoziladi va audit', async () => {
    const { controller, files, catalog, identity } = make(() =>
      of({ id: '31', type: 'VIDEO', size: file.size }),
    );
    await expect(
      controller.confirm('12', { objectKey: file.objectKey }, admin, '1.2.3.4'),
    ).resolves.toMatchObject({ id: '31' });
    expect(files.send).toHaveBeenCalledWith(
      { cmd: CREATIVE_RPC.VERIFY },
      { productId: '12', objectKey: file.objectKey },
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

  it('kreativ yozilmasa (chegara) — fayl o‘chiriladi, xato qaytadi', async () => {
    const { controller, files } = make(() =>
      throwError(() => new ConflictException('20 tadan oshmaydi')),
    );
    await expect(
      controller.confirm('12', { objectKey: file.objectKey }, admin, '1.2.3.4'),
    ).rejects.toBeDefined();
    expect(files.send).toHaveBeenCalledWith(
      { cmd: CREATIVE_RPC.REMOVE },
      { objectKey: file.objectKey },
    );
  });

  it('o‘chirish: kreativ, keyin fayl', async () => {
    const { controller, files } = make(() =>
      of({ id: '31', objectKey: file.objectKey }),
    );
    await expect(
      controller.remove('12', '31', admin, '1.2.3.4'),
    ).resolves.toEqual({ id: '31' });
    expect(files.send).toHaveBeenCalledWith(
      { cmd: CREATIVE_RPC.REMOVE },
      { objectKey: file.objectKey },
    );
  });
});
