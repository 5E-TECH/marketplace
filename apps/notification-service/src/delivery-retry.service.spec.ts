import { DeliveryRetryService } from './delivery-retry.service';
import { NotificationService } from './notification.service';

describe('DeliveryRetryService', () => {
  it('cron ishga tushganda due deliverylarni qayta ishlaydi', async () => {
    const retryDue = jest.fn().mockResolvedValue(2);
    const service = new DeliveryRetryService(
      { retryDue } as unknown as NotificationService,
      {} as never,
    );

    await expect(service.retryDue()).resolves.toBe(2);
    expect(retryDue).toHaveBeenCalledTimes(1);
  });

  it('BE-03: qulfni olmagan nusxa qayta yubormaydi', async () => {
    const retryDue = jest.fn();
    const runner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      query: jest.fn(async () => [{ locked: false }]),
      isTransactionActive: true,
      rollbackTransaction: jest.fn(async () => undefined),
      release: jest.fn(),
    };
    const dataSource = { createQueryRunner: () => runner };
    const service = new DeliveryRetryService(
      { retryDue } as unknown as NotificationService,
      dataSource as never,
    );

    await service.retryDueTick();

    expect(retryDue).not.toHaveBeenCalled();
    expect(runner.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS locked',
      [2201, 'notification-delivery-retry'],
    );
    expect(runner.release).toHaveBeenCalled();
  });
});
