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

  it('C6.6 feature RMQ so‘rovini servicega uzatadi', async () => {
    const adminFeature = jest.fn().mockResolvedValue({
      id: '9',
      isFeatured: true,
    });
    const controller = new AdminShopController({
      adminFeature,
    } as unknown as AdminShopService);

    await expect(
      controller.feature({ shopId: '9', featured: true }),
    ).resolves.toMatchObject({ isFeatured: true });
    expect(adminFeature).toHaveBeenCalledWith('9', true);
  });
});
