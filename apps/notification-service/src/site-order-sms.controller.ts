import { Controller, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventPattern, Payload } from '@nestjs/microservices';
import { LEAD_EVENTS, SiteConfirmSmsEvent } from '@app/common';
import { SmsAdapter } from './adapters/sms.adapter';

const PHONE = /^\+998\d{9}$/;
/** SMS matni chegarasi (lead-service qisqartiradi; bu — himoya) [taklif]. */
const MAX_TEXT = 480;

/**
 * BE-34: saytdan buyurtmani SMS havola bilan tasdiqlash (`lead.site.confirm-sms`). Mavjud SMS adapteri orqali
 * (`SMS_WEBHOOK_URL`; provayder — EQ-03). Yuborilmasa lid baribir havola muddatidan keyin operator navbatiga tushadi
 * (TC7) — mijoz qo‘ng‘iroq oladi. Muddati o‘tgan havola yuborilmaydi.
 */
@Controller()
export class SiteOrderSmsController {
  private readonly logger = new Logger(SiteOrderSmsController.name);

  constructor(
    private readonly sms: SmsAdapter,
    private readonly config: ConfigService,
  ) {}

  @EventPattern(LEAD_EVENTS.SITE_CONFIRM_SMS)
  async send(@Payload() event: SiteConfirmSmsEvent): Promise<void> {
    const phone = String(event?.phone ?? '');
    const text = String(event?.text ?? '').trim();
    if (!PHONE.test(phone) || !text || text.length > MAX_TEXT) {
      this.logger.warn(
        `Sayt buyurtmasi SMS: hodisa noto‘g‘ri (lid ${String(event?.leadId)})`,
      );
      return;
    }
    const expiresAt = new Date(String(event.expiresAt ?? ''));
    if (
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      this.logger.warn(
        `Sayt buyurtmasi SMS: havola muddati o‘tgan, yuborilmadi (lid ${event.leadId})`,
      );
      return;
    }
    if (!this.sms.isConfigured()) {
      // provayder yo‘q (EQ-03): prod bo‘lmagan muhitda matn logda — sinov uchun
      if (this.config.get<string>('NODE_ENV') !== 'production')
        // havola kodi logga to‘liq yozilmaydi
        this.logger.log(
          `SMS (stub) ${phone}: ${text.replace(/\/[A-Za-z0-9_-]{43}\b/, '/…')}`,
        );
      else
        this.logger.warn(
          `Sayt buyurtmasi SMS yuborilmadi — SMS_WEBHOOK_URL yo‘q (lid ${event.leadId})`,
        );
      return;
    }
    await this.sms.send({
      recipient: phone,
      title: 'Elchi Market',
      body: text,
    });
  }
}
