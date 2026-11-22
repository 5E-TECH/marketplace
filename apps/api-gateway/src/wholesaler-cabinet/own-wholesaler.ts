import { ClientProxy } from '@nestjs/microservices';
import { ForbiddenException, HttpException } from '@nestjs/common';
import {
  JwtUser,
  sendRpc,
  ShopStatus,
  WHOLESALER_CABINET_RPC,
  WholesalerProfileDto,
} from '@app/common';

/**
 * Foydalanuvchining optovigi (`catalog.shop.owner_user_id`); optovik ID si so‘rovdan olinmaydi. Yozuv yo‘q — 403
 * (ro‘yxat yakunlanmagan: `POST /wholesaler/profile`). `active` — faqat tasdiqlangan optovik (postavka).
 */
export async function ownWholesaler(
  catalog: ClientProxy,
  user: JwtUser,
  options: { active?: boolean } = {},
): Promise<WholesalerProfileDto> {
  let profile: WholesalerProfileDto;
  try {
    profile = await sendRpc<WholesalerProfileDto>(
      catalog,
      { cmd: WHOLESALER_CABINET_RPC.ME },
      { ownerUserId: user.sub },
    );
  } catch (e) {
    if (e instanceof HttpException && e.getStatus() === 404)
      throw new ForbiddenException(
        'Optovik yozuvi yo‘q — ro‘yxatni yakunlang (POST /wholesaler/profile)',
      );
    throw e;
  }
  if (options.active && profile.status !== ShopStatus.ACTIVE)
    throw new ForbiddenException(
      `Optovik holati ${profile.status} — admin tasdig‘idan keyin`,
    );
  return profile;
}
