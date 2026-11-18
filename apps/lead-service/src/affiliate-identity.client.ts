import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { RmqClient, sendRpc } from '@app/common';

/**
 * Sotuvchining profil telefoni (BE-35: «sotuvchi raqami mijoz sifatida», TZ 7). identity-service dagi mavjud
 * `identity.user.admin-get` RPC si; javobdan faqat telefon olinadi.
 */
@Injectable()
export class AffiliateIdentityClient {
  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  async phoneOf(affiliateId: string): Promise<string | null> {
    const user = await sendRpc<{ phone?: string | null } | null>(
      this.identity,
      { cmd: 'identity.user.admin-get' },
      { userId: affiliateId },
    );
    return user?.phone ?? null;
  }
}

/** Raqamni solishtirish uchun: O‘zbekiston raqamining oxirgi 9 raqami (+998 / 998 / 0 boshlanishidan qat’i nazar). */
export const phoneKey = (phone: string | null | undefined): string | null => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
};
