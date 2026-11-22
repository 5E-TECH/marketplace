import { Controller, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventPattern, Payload } from '@nestjs/microservices';
import { SmsAdapter } from './adapters/sms.adapter';

export interface VerificationCodeRequestedEvent {
  phone: string;
  code: string;
  /** REGISTER, LOGIN (BE-06), PASSWORD_RESET, PHONE_VERIFY (eski). */
  purpose: string;
}

/**
 * BE-06 (T9-9): identity `auth.verification-code.requested` — SMS kod. Ilgari qabul qiluvchi yo‘q edi (kod hech
 * kimga bormasdi). Kod bazaga (bildirishnoma jurnaliga) yozilmaydi — to‘g‘ridan-to‘g‘ri SMS adapteriga.
 * SMS sozlanmagan bo‘lsa: prod’dan boshqa muhitda kod logga chiqadi (test stub, BE-06 TC4); prod’da — xato logi.
 * Haqiqiy provayder va matn — BE-24 (EQ-03).
 */
@Controller()
export class OtpSmsController {
  private readonly logger = new Logger(OtpSmsController.name);

  constructor(
    private readonly sms: SmsAdapter,
    private readonly config: ConfigService,
  ) {}

  @EventPattern('auth.verification-code.requested')
  async onCode(
    @Payload() event: VerificationCodeRequestedEvent,
  ): Promise<void> {
    const phone = String(event?.phone ?? '');
    const code = String(event?.code ?? '');
    if (!/^\+998\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) {
      this.logger.warn('SMS kod hodisasi noto‘g‘ri — tashlandi');
      return;
    }
    if (!this.sms.isConfigured()) {
      if (this.config.get<string>('NODE_ENV') === 'production')
        this.logger.error(
          `SMS adapteri sozlanmagan — ${maskPhone(phone)} ga kod yuborilmadi`,
        );
      else
        this.logger.warn(`[SMS stub] ${phone} (${event.purpose}): kod ${code}`);
      return;
    }
    await this.deliver(phone, otpText(code, event.purpose), 0);
  }

  /**
   * BE-24 (TC5): provayder javob bermasa kod yo‘qolmaydi — u 5 daqiqa amal qiladi, SMS 15 s va 60 s dan keyin qayta
   * yuboriladi [taklif]. Kod bazaga yozilmaydi, shuning uchun qayta urinish xotirada (servis qayta ishga tushsa —
   * foydalanuvchi yangi kod so‘raydi).
   */
  private async deliver(
    phone: string,
    body: string,
    attempt: number,
  ): Promise<void> {
    try {
      await this.sms.send({ recipient: phone, title: 'Elchi', body });
    } catch (error) {
      const delay = OTP_RETRY_DELAYS_MS[attempt];
      this.logger.error(
        `SMS kod yuborilmadi (${maskPhone(phone)}, ${attempt + 1}-urinish): ${(error as Error).message}` +
          (delay ? ` — ${delay / 1000} s dan keyin qayta` : ''),
      );
      if (delay)
        setTimeout(
          () => void this.deliver(phone, body, attempt + 1),
          delay,
        ).unref?.();
    }
  }
}

/** Dizayn (xabar-otp): «{kod} — {maqsad} kodi. 5 daqiqa amal qiladi. Kodni hech kimga aytmang.» */
const OTP_PURPOSE_TEXT: Record<string, string> = {
  REGISTER: 'ro‘yxatdan o‘tish kodi',
  LOGIN: 'kabinetga kirish kodi',
  PHONE_VERIFY: 'yangi raqamni tasdiqlash kodi',
  PASSWORD_RESET: 'parolni tiklash kodi',
};

export function otpText(code: string, purpose: string): string {
  const what = OTP_PURPOSE_TEXT[String(purpose ?? '')] ?? 'tasdiqlash kodi';
  return `${code} — ${what}. 5 daqiqa amal qiladi. Kodni hech kimga aytmang.`;
}

/** OTP SMS qayta urinishlari (kod 5 daqiqa amal qiladi) [taklif]. */
export const OTP_RETRY_DELAYS_MS = [15_000, 60_000];

function maskPhone(phone: string): string {
  return `${phone.slice(0, 6)}***${phone.slice(-2)}`;
}
