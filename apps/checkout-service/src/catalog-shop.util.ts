import { ClientProxy } from '@nestjs/microservices';
import { sendRpc } from '@app/common';

/** Gateway uzatadigan sotuvchi scope'i: operator → shopId, owner → ownerUserId. */
export interface SellerScope {
  ownerUserId?: string;
  shopId?: string;
}

/** Egasining do'koni (catalog `seller.shop.get-me`). */
export function sellerShop(
  catalog: ClientProxy,
  ownerUserId: string,
): Promise<{ id: string }> {
  return sendRpc(catalog, { cmd: 'seller.shop.get-me' }, { ownerUserId });
}

/** Scope: operator → JWT shopId (to'g'ridan); owner → ownerUserId'dan resolve. */
export async function resolveSellerShopId(
  catalog: ClientProxy,
  scope: SellerScope,
): Promise<string> {
  if (scope.shopId) return String(scope.shopId);
  const shop = await sellerShop(catalog, String(scope.ownerUserId));
  return String(shop.id);
}

/** Do'kon egasining user ID si — bildirishnoma qabul qiluvchisi. */
export async function shopOwnerUserId(
  catalog: ClientProxy,
  shopId: string,
): Promise<string> {
  const shop = await sendRpc<{ ownerUserId: string }>(
    catalog,
    { cmd: 'catalog.shop.get-by-id' },
    { shopId },
  );
  return String(shop.ownerUserId);
}
