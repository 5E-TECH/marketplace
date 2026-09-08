import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  OutboxEvent,
  OutboxStatus,
  PaymentPaidEvent,
  RmqClient,
  sendRpc,
} from '@app/common';
import { EntityManager } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { Payment } from './entities/payment.entity';

@Injectable()
export class PaymentEventsService {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  async recordPaid(payment: Payment, manager: EntityManager): Promise<void> {
    await manager.getRepository(OutboxEvent).upsert(
      {
        aggregateType: 'Payment',
        aggregateId: payment.id,
        eventType: 'payment.paid',
        payload: this.payload(payment),
        status: OutboxStatus.PENDING,
      },
      {
        conflictPaths: ['aggregateType', 'aggregateId', 'eventType'],
        skipUpdateIfNoValuesChanged: true,
      },
    );
  }

  async publish(event: OutboxEvent): Promise<void> {
    // Request/reply ensures checkout actually handled the payment before marking
    // the outbox row processed. Checkout confirms idempotently on retries.
    await sendRpc(
      this.checkout,
      { cmd: 'checkout.payment-paid' },
      event.payload,
    );
  }

  async paid(payment: Payment): Promise<void> {
    await firstValueFrom(
      this.checkout.emit('payment.paid', this.payload(payment)),
    );
  }

  private payload(payment: Payment): PaymentPaidEvent {
    return {
      paymentId: String(payment.id),
      salesOrderId: String(payment.salesOrderId),
      provider: payment.provider,
      amount: Number(payment.amount),
      paidAt: (payment.paidAt ?? new Date()).toISOString(),
    };
  }
}
