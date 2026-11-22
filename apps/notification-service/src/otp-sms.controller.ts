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
    try {
      await this.sms.send({
        recipient: phone,
        title: 'Elchi',
        body: `Elchi: tasdiqlash kodi ${code}. Hech kimga aytmang.`,
      });
    } catch (error) {
      // bitta urinish: kod 5 daqiqa amal qiladi, foydalanuvchi qayta so‘raydi
      this.logger.error(
        `SMS kod yuborilmadi (${maskPhone(phone)}): ${(error as Error).message}`,
      );
    }
  }
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 6)}***${phone.slice(-2)}`;
}
