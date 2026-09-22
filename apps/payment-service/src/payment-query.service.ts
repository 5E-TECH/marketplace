import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  PaymentProvider,
  PaymentStatus,
  PaymentSummaryDto,
  publicPaymentStatus,
} from '@app/common';
import { Payment } from './entities/payment.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { validReference } from './payment-atomic';

/**
 * Bitta buyurtmada bir nechta payment yozuvi bo'lishi mumkin (xaridor Payme'da
 * boshlab, keyin Click'ga o'tgan). Xaridorga ko'rsatiladigan holat — eng
 * "yakuniy" bo'lgani: to'langan/qaytarilgan yozuv har doim ustun, aks holda
 * eng oxirgi urinish.
 */
const STATUS_RANK: Record<PaymentStatus, number> = {
  // REFUNDED — PAID dan keyin keladigan yakuniy holat, shuning uchun ustunroq.
  [PaymentStatus.REFUNDED]: 5,
  [PaymentStatus.PAID]: 4,
  [PaymentStatus.PENDING]: 3,
  [PaymentStatus.CREATED]: 2,
  [PaymentStatus.FAILED]: 1,
  [PaymentStatus.CANCELLED]: 0,
};

/** Payme CancelTransaction `reason` kodlari (Merchant API). */
const PAYME_CANCEL_REASON: Record<number, string> = {
  1: 'Qabul qiluvchi tomon topilmadi',
  2: 'Hisobdan yechishda xatolik',
  3: 'Tranzaksiyani bajarishda xatolik',
  4: 'Tranzaksiya vaqt tugashi sababli bekor qilindi',
  5: 'Pul qaytarildi',
  10: 'Noma’lum xatolik',
};

@Injectable()
export class PaymentQueryService {
  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(PaymentTransaction)
    private readonly transactions: Repository<PaymentTransaction>,
  ) {}

  /**
   * Buyurtma ID'lari bo'yicha to'lov holati. Checkout-service buyurtma
   * ro'yxati va tracking javobini shu bilan boyitadi — payment sxemasiga
   * to'g'ridan-to'g'ri SQL yozmaydi (least-privilege).
   */
  async summaryByOrders(
    salesOrderIds: string[],
  ): Promise<Record<string, PaymentSummaryDto>> {
    const ids = [
      ...new Set(
        (salesOrderIds ?? []).map((id) => String(id)).filter(validReference),
      ),
    ];
    if (!ids.length) return {};

    const rows = await this.payments.find({
      where: { salesOrderId: In(ids) },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const best = new Map<string, Payment>();
    for (const payment of rows) {
      const current = best.get(payment.salesOrderId);
      // `rows` yangidan eskiga tartiblangan, shuning uchun teng rankda
      // birinchi uchragani (eng yangisi) qoladi.
      if (!current || STATUS_RANK[payment.status] > STATUS_RANK[current.status])
        best.set(payment.salesOrderId, payment);
    }

    const summaries: Record<string, PaymentSummaryDto> = {};
    for (const [salesOrderId, payment] of best) {
      summaries[salesOrderId] = {
        paymentId: payment.id,
        salesOrderId,
        provider: payment.provider,
        status: publicPaymentStatus(payment.status),
        amount: Number(payment.amount),
        paidAt: payment.paidAt,
        updatedAt: payment.updatedAt,
        failureReason: await this.failureReason(payment),
      };
    }
    return summaries;
  }

  /** Bekor qilingan/muvaffaqiyatsiz to'lovning sababi — o'qiladigan matn. */
  private async failureReason(payment: Payment): Promise<string | null> {
    if (
      payment.status !== PaymentStatus.CANCELLED &&
      payment.status !== PaymentStatus.FAILED
    )
      return null;
    const transaction = await this.transactions.findOne({
      where: { paymentId: payment.id },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    if (!transaction) return 'To‘lov yakunlanmadi';
    if (payment.provider === PaymentProvider.PAYME) {
      return (
        PAYME_CANCEL_REASON[Number(transaction.reason)] ??
        'To‘lov provayder tomonidan bekor qilindi'
      );
    }
    const note = transaction.raw?.error_note;
    return typeof note === 'string' && note.trim()
      ? note.trim()
      : 'To‘lov provayder tomonidan bekor qilindi';
  }
}
