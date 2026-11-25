import { ConflictException, HttpException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  AFFILIATE_AUTH_RPC,
  affiliateFullName,
  AffiliateProfileDto,
  ErrorCode,
  SELF_EMPLOYED_RPC,
  sendRpc,
} from '@app/common';

/** Sotuvchining profildagi hozirgi ism-familiyasi. */
export async function currentFullName(
  identity: ClientProxy,
  affiliateId: string,
): Promise<string> {
  return affiliateFullName(
    await sendRpc<AffiliateProfileDto>(
      identity,
      { cmd: AFFILIATE_AUTH_RPC.PROFILE_GET },
      { userId: affiliateId },
    ),
  );
}

/**
 * Profildagi ism tasdiqlangan yoki tekshirilayotgan ismdan farq qilsa (NAME_CHANGED): maqom shu yerda hozirgi ism bilan
 * qayta tekshiruvga qo‘yiladi — ariza tasdiqlab ham, rad etib ham bo‘lmaydigan holatda qolib ketmaydi.
 */
export async function recheckOnNameChange<T>(
  finance: ClientProxy,
  affiliateId: string,
  fullName: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (errorCodeOf(error) !== ErrorCode.NAME_CHANGED || !fullName) throw error;
    await sendRpc(
      finance,
      { cmd: SELF_EMPLOYED_RPC.RENAME },
      { affiliateId, fullName },
    );
    throw new ConflictException({
      message:
        'Sotuvchi ismini o‘zgartirgan — maqom hozirgi ism bilan qayta tekshiruvga qo‘yildi',
      errorCode: ErrorCode.NAME_CHANGED,
    });
  }
}

function errorCodeOf(error: unknown): unknown {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  return typeof body === 'object'
    ? (body as { errorCode?: unknown }).errorCode
    : undefined;
}
