import { ConflictException, HttpException, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  AFFILIATE_AUTH_RPC,
  affiliateFullName,
  AffiliateProfileDto,
  ErrorCode,
  RenameSelfEmployedResult,
  SELF_EMPLOYED_RPC,
  SelfEmployedStatus,
  sendRpc,
} from '@app/common';

const logger = new Logger('SelfEmployedRecheck');

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
  clients: { finance: ClientProxy; identity: ClientProxy },
  target: { affiliateId: string; fullName: string; actorId: string },
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const { affiliateId, fullName, actorId } = target;
    if (errorCodeOf(error) !== ErrorCode.NAME_CHANGED || !fullName) throw error;
    const { info } = await sendRpc<RenameSelfEmployedResult>(
      clients.finance,
      { cmd: SELF_EMPLOYED_RPC.RENAME },
      { affiliateId, fullName },
    );
    void sendRpc(
      clients.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action: 'self-employed.recheck',
        entityType: 'User',
        entityId: affiliateId,
        meta: { status: info.status },
      },
    ).catch((e: Error) =>
      logger.warn(`Qayta tekshiruv auditga yozilmadi: ${e.message}`),
    );
    throw new ConflictException({
      message:
        info.status === SelfEmployedStatus.PENDING
          ? 'Sotuvchi ismini o‘zgartirgan — maqom hozirgi ism bilan qayta tekshiruvga qo‘yildi'
          : 'Sotuvchi ismini o‘zgartirgan — maqom bekor qilindi, sotuvchi JShShIR ni yuborishi kerak',
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
