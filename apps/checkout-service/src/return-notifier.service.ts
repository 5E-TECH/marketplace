import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { ReturnRequestStatus, RmqClient } from '@app/common';
import { shopOwnerUserId } from './catalog-shop.util';

export interface ReturnNotice {
  returnId: string;
  orderId: string;
  status: ReturnRequestStatus;
  comment?: string | null;
  amount?: number;
}

/**
 * Qaytarish so'rovi holati o'zgarganda `return.status-changed` hodisasi.
 * Bildirishnoma — yon ta'sir: u yiqilsa asosiy amal (pul qaytarish) bekor
 * bo'lmasligi kerak, shuning uchun xato faqat logga yoziladi.
 */
@Injectable()
export class ReturnNotifierService {
  private readonly logger = new Logger(ReturnNotifierService.name);

  constructor(
    @Optional()
    @Inject(RmqClient.NOTIFICATION)
    private readonly notifications?: ClientProxy,
    @Optional()
    @Inject(RmqClient.CATALOG)
    private readonly catalog?: ClientProxy,
  ) {}

  async notify(
    notice: ReturnNotice,
    to: { customerId?: string; shopId?: string },
  ): Promise<void> {
    if (!this.notifications) return;
    try {
      const userIds: string[] = [];
      if (to.customerId) userIds.push(String(to.customerId));
      if (to.shopId && this.catalog) {
        userIds.push(await shopOwnerUserId(this.catalog, to.shopId));
      }
      const recipients = [...new Set(userIds)].map((userId) => ({ userId }));
      if (!recipients.length) return;
      await firstValueFrom(
        this.notifications.emit('return.status-changed', {
          ...notice,
          recipients,
        }),
        { defaultValue: undefined },
      );
    } catch (error) {
      this.logger.warn(
        `return #${notice.returnId} bildirishnomasi yuborilmadi: ${
          (error as Error).message
        }`,
      );
    }
  }
}
