import { of } from 'rxjs';
import { Role } from '@app/common';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  it('in-app list uchun JWT user ID sini RPC payloadga uzatadi', () => {
    const send = jest.fn(() => of({}));
    const controller = new NotificationsController({ send } as never);

    controller.list({ sub: '401', role: Role.SELLER } as never, {
      page: 1,
      limit: 20,
      unreadOnly: 'true',
    });

    expect(send).toHaveBeenCalledWith(
      { cmd: 'notifications.list' },
      {
        userId: '401',
        query: { page: 1, limit: 20, unreadOnly: 'true' },
      },
    );
  });

  it('boshqa user ID sini bodydan qabul qilmaydi', () => {
    const send = jest.fn(() => of({}));
    const controller = new NotificationsController({ send } as never);

    controller.markRead({ sub: '401', role: Role.BUYER } as never, '77');

    expect(send).toHaveBeenCalledWith(
      { cmd: 'notifications.mark-read' },
      { userId: '401', id: '77' },
    );
  });
});
