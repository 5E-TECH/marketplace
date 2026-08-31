import { ForbiddenException } from '@nestjs/common';
import { ReviewEligibilityService } from './review-eligibility.service';

describe('ReviewEligibilityService (C4.1)', () => {
  function setup(row: Record<string, unknown>) {
    const dataSource = { query: jest.fn().mockResolvedValue([row]) };
    return {
      service: new ReviewEligibilityService(dataSource as never),
      dataSource,
    };
  }

  const delivered = {
    orderItemId: '31',
    customerId: '42',
    productId: '12',
    shopId: '5',
    sellerOrderId: '9',
    status: 'DELIVERED',
  };

  it('TC1: delivered buyurtma egasiga sharhga ruxsat beradi', async () => {
    const { service } = setup(delivered);
    await expect(service.verify('42', '31', '12')).resolves.toEqual(delivered);
  });

  it('TC1: boshqa userga sharh qoldirishni rad etadi', async () => {
    const { service } = setup(delivered);
    await expect(service.verify('99', '31', '12')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('TC1: delivered bo‘lmagan orderni rad etadi', async () => {
    const { service } = setup({ ...delivered, status: 'CONFIRMED' });
    await expect(service.verify('42', '31', '12')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
