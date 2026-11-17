import { of } from 'rxjs';
import { OutboxEvent, OutboxPermanentError } from '@app/common';
import { ElchiOutboxRelayService } from './elchi-outbox-relay.service';

describe('ElchiOutboxRelayService (BE-20)', () => {
  function setup(events: Array<Partial<OutboxEvent>>) {
    const errors: unknown[] = [];
    const outbox = {
      relayPending: jest.fn(
        async (publish: (event: OutboxEvent) => Promise<void>) => {
          let sent = 0;
          for (const event of events) {
            try {
              await publish(event as OutboxEvent);
              sent++;
            } catch (error) {
              errors.push(error);
            }
          }
          return sent;
        },
      ),
    };
    const checkout = { emit: jest.fn(() => of(undefined)) };
    return {
      relay: new ElchiOutboxRelayService(
        outbox as never,
        checkout as never,
        {
          get: () => relayFlag,
        } as never,
      ),
      checkout,
      outbox,
      errors,
    };
  }
  let relayFlag: string | undefined = 'on';
  beforeEach(() => {
    relayFlag = 'on';
  });

  it('ELCHI_OUTBOX_RELAY yoqilmagan bo‘lsa hodisalar PENDING qoladi', async () => {
    relayFlag = undefined;
    const { relay, outbox, checkout } = setup([
      { eventType: 'elchi.parcel.created', payload: {} },
    ]);
    await expect(relay.relayPending()).resolves.toBe(0);
    expect(outbox.relayPending).not.toHaveBeenCalled();
    expect(checkout.emit).not.toHaveBeenCalled();
  });

  it('elchi.parcel.* hodisasini checkout ga o‘z nomi bilan yuboradi', async () => {
    const payload = { eventId: 'elchi.parcel.created:501', orderId: '501' };
    const { relay, checkout } = setup([
      { eventType: 'elchi.parcel.created', payload },
    ]);
    await expect(relay.relayPending()).resolves.toBe(1);
    expect(checkout.emit).toHaveBeenCalledWith('elchi.parcel.created', payload);
  });

  it('boshqa hodisa turi qayta urinilmaydigan xato', async () => {
    const { relay, checkout, errors } = setup([
      { eventType: 'finance.payout.requested', payload: {} },
    ]);
    await expect(relay.relayPending()).resolves.toBe(0);
    expect(checkout.emit).not.toHaveBeenCalled();
    expect(errors[0]).toBeInstanceOf(OutboxPermanentError);
  });
});
