import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PaymentPaidEvent, RmqClient } from '@app/common';
import { firstValueFrom } from 'rxjs';
import { Payment } from './entities/payment.entity';

@Injectable()
export class PaymentEventsService {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  async paid(payment: Payment): Promise<void> {
    const event: PaymentPaidEvent = {
      paymentId: String(payment.id),
      salesOrderId: String(payment.salesOrderId),
      provider: payment.provider,
      amount: Number(payment.amount),
      paidAt: (payment.paidAt ?? new Date()).toISOString(),
    };
    await firstValueFrom(this.checkout.emit('payment.paid', event));
  }
}
