import { of } from 'rxjs';
import { InventoryOutboxRelayService } from './inventory-outbox-relay.service';

describe('InventoryOutboxRelayService', () => {
  it('PENDING eventni catalog queue’ga yuboradi', async () => {
    const event = {
      eventType: 'inventory.stock_depleted',
      payload: { variantId: '101', status: 'OUT_OF_STOCK' },
    };
    const outbox = {
      relayPending: jest.fn(async (publish) => {
        await publish(event);
        return 1;
      }),
    };
    const catalogClient = {
      emit: jest.fn(() => of(undefined)),
    };
    const relay = new InventoryOutboxRelayService(
      outbox as never,
      catalogClient as never,
    );

    await expect(relay.relayPending()).resolves.toBe(1);
    expect(catalogClient.emit).toHaveBeenCalledWith(
      'inventory.stock_depleted',
      event.payload,
    );
  });
});
