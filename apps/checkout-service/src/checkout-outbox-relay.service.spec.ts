import { of, throwError } from 'rxjs';
import { OutboxEvent, OutboxPermanentError } from '@app/common';
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
    const lead = { emit: jest.fn(() => of(undefined)) };
    const integration = { emit: jest.fn(() => of(undefined)) };
    const inventory = { send: jest.fn((): unknown => of({ ok: true })) };
    const notification = { emit: jest.fn(() => of(undefined)) };
    const relay = new CheckoutOutboxRelayService(
      outbox as never,
      finance as never,
      lead as never,
      integration as never,
      inventory as never,
      notification as never,
    );
    return {
      relay,
      finance,
      lead,
      integration,
      inventory,
      notification,
      results,
    };
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

  it('noma’lum hodisa yuborilmaydi — qayta urinilmaydigan xato (FAILED)', async () => {
    const { relay, finance, results } = setup([
      { id: '2', eventType: 'order.created', payload: {} },
    ]);

    await expect(relay.relayPending()).resolves.toBe(0);
    expect(finance.emit).not.toHaveBeenCalled();
    expect(results[0]).toBeInstanceOf(OutboxPermanentError);
  });

  it('BE-18: order.status.changed — moliya, lid va Elchi integratsiyasi navbatlariga (har biriga alohida)', async () => {
    const payload = { eventId: 'evt_1', orderId: '7', status: 'CONFIRMED' };
    const { relay, finance, lead, integration } = setup([
      { id: '3', eventType: 'order.status.changed', payload },
    ]);

    await expect(relay.relayPending()).resolves.toBe(1);
    for (const client of [finance, lead, integration])
      expect(client.emit).toHaveBeenCalledWith('order.status.changed', payload);
  });

  it('BE-18: order.create-failed — faqat lid servisiga', async () => {
    const payload = { eventId: 'evt_2', leadId: '9', reason: 'OUT_OF_STOCK' };
    const { relay, finance, lead, integration } = setup([
      { id: '4', eventType: 'order.create-failed', payload },
    ]);

    await expect(relay.relayPending()).resolves.toBe(1);
    expect(lead.emit).toHaveBeenCalledWith('order.create-failed', payload);
    expect(finance.emit).not.toHaveBeenCalled();
    expect(integration.emit).not.toHaveBeenCalled();
  });

  it('BE-18: bitta navbat yiqilsa hodisa yuborilmagan hisoblanadi (qayta urinish, iste’molchilar takrorni tashlaydi)', async () => {
    const { relay, lead, results } = setup([
      { id: '5', eventType: 'order.status.changed', payload: {} },
    ]);
    lead.emit.mockImplementation(() => {
      throw new Error('lid navbati yo‘q');
    });

    await expect(relay.relayPending()).resolves.toBe(0);
    expect(results[0]).toBeInstanceOf(Error);
    expect(results[0]).not.toBeInstanceOf(OutboxPermanentError);
  });

  it('BE-18: ombor buyrug‘i (bekor — band bo‘shaydi) RPC bilan yuboriladi; ombor yiqilsa — qayta urinish', async () => {
    const payload = { orderRef: '7', idempotencyKey: 'lead-order-cancel:7' };
    const ok = setup([{ id: '6', eventType: 'inventory.release', payload }]);
    await expect(ok.relay.relayPending()).resolves.toBe(1);
    expect(ok.inventory.send).toHaveBeenCalledWith(
      { cmd: 'inventory.release' },
      payload,
    );
    expect(ok.finance.emit).not.toHaveBeenCalled();

    const down = setup([{ id: '7', eventType: 'inventory.commit', payload }]);
    down.inventory.send.mockImplementation(() =>
      throwError(() => ({ statusCode: 503, message: 'ombor yo‘q' })),
    );
    await expect(down.relay.relayPending()).resolves.toBe(0);
    expect(down.results[0]).not.toBeInstanceOf(OutboxPermanentError);
  });

  it('BE-18: ombor 4xx (band yo‘q yoki boshqa holatda) — qaytarilmas xato (FAILED, logda)', async () => {
    const { relay, inventory, results } = setup([
      { id: '8', eventType: 'inventory.release', payload: { orderRef: '7' } },
    ]);
    inventory.send.mockImplementation(() =>
      throwError(() => ({
        statusCode: 409,
        message: 'Rezervatsiya holati COMMITTED',
        errorCode: 'INVALID_STATE',
      })),
    );
    await expect(relay.relayPending()).resolves.toBe(0);
    expect(results[0]).toBeInstanceOf(OutboxPermanentError);
  });

  it('BE-24: order.status.changed notification-service ga ham (mijozga SMS, BUY-6)', async () => {
    const payload = { eventId: 'evt_sms', orderId: '7' };
    const { relay, notification } = setup([
      { id: '9', eventType: 'order.status.changed', payload },
    ]);
    await expect(relay.relayPending()).resolves.toBe(1);
    expect(notification.emit).toHaveBeenCalledWith(
      'order.status.changed',
      payload,
    );
  });
});
