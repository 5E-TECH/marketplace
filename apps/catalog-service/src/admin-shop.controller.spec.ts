import { AdminShopController } from './admin-shop.controller';
import { AdminShopService } from './admin-shop.service';

describe('AdminShopController', () => {
  it('publish-approved RMQ so‘roviga acknowledgement qaytaradi', async () => {
    const publishShopApproved = jest.fn().mockResolvedValue(undefined);
    const controller = new AdminShopController({
      publishShopApproved,
    } as unknown as AdminShopService);
    const payload = {
      sellerUserId: '42',
      shopId: '9',
      shopName: 'QA shop',
      phone: '+998901234567',
    };

    await expect(controller.publishApproved(payload)).resolves.toEqual({
      published: true,
    });
    expect(publishShopApproved).toHaveBeenCalledWith(payload);
  });
});
