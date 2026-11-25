import { HttpException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminOrderReturnsController } from './admin-order-returns.controller';

const upload = (size = 3) =>
  ({ size, buffer: Buffer.from([0xff, 0xd8, 0xff]) }) as never;
const admin = { sub: '7', role: Role.ADMIN } as never;

/** BE-25 (FE-26): qaytarish so‘roviga mijoz rasmlari. */
describe('AdminOrderReturnsController: rasmlar', () => {
  const setup = (add: () => unknown) => {
    const checkout = jest.fn((pattern: { cmd: string }) =>
      pattern.cmd === 'checkout.admin.return-photo-check'
        ? of({ returnId: '3' })
        : add(),
    );
    let n = 0;
    const files = jest.fn((pattern: { cmd: string }) =>
      of(
        pattern.cmd === 'file.return-photo.store'
          ? {
              objectKey: `private/returns/3/${++n}.jpg`,
              contentType: 'image/jpeg',
              size: 3,
            }
          : { removed: true },
      ),
    );
    const audit = jest.fn(() => of({}));
    return {
      controller: new AdminOrderReturnsController(
        { send: checkout } as never,
        { send: audit } as never,
        { send: files } as never,
      ),
      checkout,
      files,
      audit,
    };
  };
  const removed = (files: jest.Mock) =>
    files.mock.calls.filter(([p]) => p.cmd === 'file.return-photo.remove');

  it('faqat admin; fayllar navbatda diskka yozilmaydi; so‘rovga yoziladi va auditga', async () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminOrderReturnsController.prototype.photos,
      ),
    ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    const { controller, checkout, files, audit } = setup(() =>
      of({ returnId: '3', count: 2, photos: [] }),
    );
    await expect(
      controller.photos('42', [upload(), upload()], admin, '10.0.0.1'),
    ).resolves.toMatchObject({ count: 2 });
    expect(checkout).toHaveBeenNthCalledWith(
      1,
      { cmd: 'checkout.admin.return-photo-check' },
      { orderId: '42', count: 2 },
    );
    expect(checkout).toHaveBeenNthCalledWith(
      2,
      { cmd: 'checkout.admin.return-photo-add' },
      expect.objectContaining({
        orderId: '42',
        returnId: '3',
        actorId: '7',
        files: [
          expect.objectContaining({ objectKey: 'private/returns/3/1.jpg' }),
          expect.objectContaining({ objectKey: 'private/returns/3/2.jpg' }),
        ],
      }),
    );
    expect(
      (files.mock.calls[0] as unknown[])[1] as { options: unknown },
    ).toMatchObject({ options: { persistent: false } });
    expect(audit).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'return.photos.add', entityId: '3' }),
    );
  });

  it('rasmsiz — 400; yozish rad etilsa (409) — saqlangan rasmlar o‘chiriladi; javob noma’lum (504) — tegilmaydi', async () => {
    const rejected = (status: number) => () =>
      throwError(() => new HttpException('x', status));
    const conflict = setup(rejected(409));
    await expect(
      conflict.controller.photos('42', [upload(0)], admin, ''),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'FILE_REQUIRED' }),
    });
    expect(conflict.checkout).not.toHaveBeenCalled();
    await expect(
      conflict.controller.photos('42', [upload(), upload()], admin, ''),
    ).rejects.toMatchObject({ status: 409 });
    expect(removed(conflict.files)).toHaveLength(2);

    const unknown = setup(rejected(504));
    await expect(
      unknown.controller.photos('42', [upload()], admin, ''),
    ).rejects.toBeDefined();
    expect(removed(unknown.files)).toHaveLength(0);
  });
});
