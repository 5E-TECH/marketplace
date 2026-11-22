import { ClientProxy } from '@nestjs/microservices';
import { sendRpc } from '@app/common';

/**
 * Do'kon egasining user ID si — bildirishnoma qabul qiluvchisi. BE-07: admin kiritgan optovikda foydalanuvchi yo‘q —
 * `null` (qabul qiluvchi qo‘shilmaydi).
 */
export async function shopOwnerUserId(
  catalog: ClientProxy,
  shopId: string,
): Promise<string | null> {
  const shop = await sendRpc<{ ownerUserId: string | null }>(
    catalog,
    { cmd: 'catalog.shop.get-by-id' },
    { shopId },
  );
  return shop.ownerUserId == null ? null : String(shop.ownerUserId);
}
