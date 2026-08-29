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
import { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
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
    const payment = await this.findPayment(dto);
    if (!payment) throw new NotFoundException('To‘lov topilmadi');
    if (payment.status === PaymentStatus.REFUNDED) {
      return this.result(payment, true);
    }
    if (payment.status !== PaymentStatus.PAID) {
      throw new BadRequestException('Faqat to‘langan payment refund qilinadi');
    }

    if (payment.provider === PaymentProvider.PAYME) {
      await this.payme.cancelPaidPayment(payment);
    } else {
      await this.cancelClickTransaction(payment, dto.reason);
    }
    payment.status = PaymentStatus.REFUNDED;
    await this.payments.save(payment);
    return this.result(payment, false);
  }

  private async findPayment(dto: RefundPaymentDto): Promise<Payment | null> {
    if (dto.paymentId) {
      const byId = await this.payments.findOne({
        where: { id: dto.paymentId },
      });
      if (byId) return byId;
    }
    return this.payments.findOne({
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

  private result(payment: Payment, idempotent: boolean): RefundPaymentResult {
    return {
      paymentId: payment.id,
      salesOrderId: payment.salesOrderId,
      provider: payment.provider,
      status: PaymentStatus.REFUNDED,
      providerTransactionId: payment.externalTxnId,
      idempotent,
    };
  }
}
