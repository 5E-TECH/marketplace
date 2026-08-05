import { DeliveryRetryService } from './delivery-retry.service';
import { NotificationService } from './notification.service';

describe('DeliveryRetryService', () => {
  it('cron ishga tushganda due deliverylarni qayta ishlaydi', async () => {
    const retryDue = jest.fn().mockResolvedValue(2);
    const service = new DeliveryRetryService({
      retryDue,
    } as unknown as NotificationService);

    await expect(service.retryDue()).resolves.toBe(2);
    expect(retryDue).toHaveBeenCalledTimes(1);
  });
});
