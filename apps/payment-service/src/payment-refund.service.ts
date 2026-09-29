import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PaymentProvider,
  PaymentStatus,
  RefundPaymentDto,
  RefundPaymentResult,
} from '@app/common';
import { EntityManager, Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentRefund } from './entities/payment-refund.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { paymentAtomic } from './payment-atomic';
import { PaymeService } from './payme.service';

@Injectable()
export class PaymentRefundService {
  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(PaymentTransaction)
    private readonly transactions: Repository<PaymentTransaction>,
    private readonly payme: PaymeService,
  ) {}

  async refund(dto: RefundPaymentDto): Promise<RefundPaymentResult> {
    if (dto.amount !== undefined) return this.partialRefund(dto);
    const payment = await this.findPayment(dto);
    if (!payment) throw new NotFoundException('To‘lov topilmadi');
    if (payment.status === PaymentStatus.REFUNDED) {
      return this.result(payment, true);
    }
    if (payment.status !== PaymentStatus.PAID) {
      throw new BadRequestException('Faqat to‘langan payment refund qilinadi');
    }

    await this.cancelProviderTransaction(payment, dto.reason);
    payment.status = PaymentStatus.REFUNDED;
    await this.payments.save(payment);
    return this.result(payment, false);
  }

  /**
   * C4.2 — qaytarish so'rovi bo'yicha qisman refund. Har chaqiruv
   * `idempotencyKey` bilan bir marta yoziladi; jami qaytarilgan summa to'lov
   * summasidan oshmaydi. Qoldiq nolga tushsa provayder tranzaksiyasi bekor
   * qilinadi va to'lov REFUNDED bo'ladi, aks holda PAID qoladi.
   */
  private partialRefund(dto: RefundPaymentDto): Promise<RefundPaymentResult> {
    return paymentAtomic(this.payments, async (manager) => {
      const payments = manager.getRepository(Payment);
      const refunds = manager.getRepository(PaymentRefund);
      const existing = await refunds.findOne({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      const payment = existing
        ? await payments.findOne({ where: { id: existing.paymentId } })
        : await this.findPayment(dto, payments);
      if (!payment) throw new NotFoundException('To‘lov topilmadi');
      if (existing) {
        return this.result(
          payment,
          true,
          existing.amount,
          await this.refundedTotal(manager, payment.id),
        );
      }
      if (payment.status !== PaymentStatus.PAID) {
        throw new BadRequestException(
          payment.status === PaymentStatus.REFUNDED
            ? 'To‘lov allaqachon to‘liq qaytarilgan'
            : 'Faqat to‘langan payment refund qilinadi',
        );
      }

      const refundedBefore = await this.refundedTotal(manager, payment.id);
      const remaining = this.money(Number(payment.amount) - refundedBefore);
      const amount = this.money(Number(dto.amount));
      if (!(amount > 0) || amount > remaining) {
        throw new BadRequestException(
          `Qaytariladigan summa 0 dan katta va ${remaining} dan oshmasligi kerak`,
        );
      }
      await refunds.save(
        refunds.create({
          paymentId: payment.id,
          amount,
          reason: dto.reason,
          idempotencyKey: dto.idempotencyKey,
        }),
      );
      if (amount === remaining) {
        await this.cancelProviderTransaction(payment, dto.reason);
        payment.status = PaymentStatus.REFUNDED;
        await payments.save(payment);
      }
      return this.result(
        payment,
        false,
        amount,
        this.money(refundedBefore + amount),
      );
    });
  }

  private async refundedTotal(
    manager: EntityManager,
    paymentId: string,
  ): Promise<number> {
    const [row] = (await manager.query(
      `SELECT COALESCE(SUM(amount),0)::float8 AS total
         FROM payment.payment_refund WHERE payment_id=$1`,
      [paymentId],
    )) as Array<{ total: number }>;
    return this.money(Number(row?.total ?? 0));
  }

  private async cancelProviderTransaction(
    payment: Payment,
    reason: string,
  ): Promise<void> {
    if (payment.provider === PaymentProvider.PAYME) {
      await this.payme.cancelPaidPayment(payment);
    } else {
      await this.cancelClickTransaction(payment, reason);
    }
  }

  private async findPayment(
    dto: RefundPaymentDto,
    payments: Repository<Payment> = this.payments,
  ): Promise<Payment | null> {
    if (dto.paymentId) {
      const byId = await payments.findOne({
        where: { id: dto.paymentId },
      });
      if (byId) return byId;
    }
    return payments.findOne({
      where: { salesOrderId: dto.salesOrderId },
      order: { createdAt: 'DESC' },
    });
  }

  private async cancelClickTransaction(
    payment: Payment,
    reason: string,
  ): Promise<void> {
    const transaction = await this.transactions.findOne({
      where: { paymentId: payment.id },
      order: { createdAt: 'DESC' },
    });
    if (!transaction)
      throw new NotFoundException('Click tranzaksiyasi topilmadi');
    if (transaction.state !== 2 && transaction.state !== -2) {
      throw new BadRequestException(
        'Faqat bajarilgan Click tranzaksiyasini refund qilish mumkin',
      );
    }
    if (transaction.state === -2) return;
    transaction.state = -2;
    transaction.cancelTime = String(Date.now());
    transaction.reason = 5;
    transaction.action = 'Refund';
    transaction.raw = { ...(transaction.raw ?? {}), refundReason: reason };
    await this.transactions.save(transaction);
  }

  private result(
    payment: Payment,
    idempotent: boolean,
    amount?: number,
    refundedTotal?: number,
  ): RefundPaymentResult {
    return {
      paymentId: payment.id,
      salesOrderId: payment.salesOrderId,
      provider: payment.provider,
      status:
        payment.status === PaymentStatus.REFUNDED
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PAID,
      providerTransactionId: payment.externalTxnId,
      idempotent,
      ...(amount === undefined ? {} : { amount, refundedTotal }),
    };
  }

  private money(value: number): number {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }
}
