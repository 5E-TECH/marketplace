import { of } from 'rxjs';
import { OutboxEvent } from '@app/common';
import { CheckoutOutboxRelayService } from './checkout-outbox-relay.service';

describe('CheckoutOutboxRelayService (BE-03)', () => {
  function setup(events: Array<Partial<OutboxEvent>>) {
    const results: Array<'sent' | Error> = [];
    const outbox = {
      relayPending: jest.fn(
        async (publish: (event: OutboxEvent) => Promise<void>) => {
          let sent = 0;
          for (const event of events) {
            try {
              await publish(event as OutboxEvent);
              results.push('sent');
              sent++;
            } catch (error) {
              results.push(error as Error);
            }
          }
          return sent;
        },
      ),
    };
    const finance = { emit: jest.fn(() => of(undefined)) };
    const relay = new CheckoutOutboxRelayService(
      outbox as never,
      finance as never,
    );
    return { relay, finance, results };
  }

  it('moliya hodisasini o‘z nomi va payload i bilan finance ga yuboradi', async () => {
    const payload = { eventId: 'evt_sold', sellerOrderId: '55' };
    const { relay, finance } = setup([
      { id: '1', eventType: 'finance.payout.requested', payload },
    ]);

    await expect(relay.relayPending()).resolves.toBe(1);
    expect(finance.emit).toHaveBeenCalledWith(
      'finance.payout.requested',
      payload,
    );
  });

  it('noma’lum hodisa yuborilmaydi va xato bilan PENDING qoladi', async () => {
    const { relay, finance, results } = setup([
      { id: '2', eventType: 'order.created', payload: {} },
    ]);

    await expect(relay.relayPending()).resolves.toBe(0);
    expect(finance.emit).not.toHaveBeenCalled();
    expect(results[0]).toBeInstanceOf(Error);
  });
});
