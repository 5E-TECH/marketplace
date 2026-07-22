import { OutboxService } from './outbox.service';
import { OutboxStatus } from './outbox-event.entity';

// TC6: outbox event faqat 1 marta publish qilinadi
describe('OutboxService (TC6)', () => {
  const makeRepo = () => {
    const events: any[] = [];
    return {
      events,
      create: (o: any) => ({ ...o }),
      save: jest.fn(async (e: any) => {
        if (!e.id) {
          e.id = String(events.length + 1);
          events.push(e);
        }
        return e;
      }),
      find: jest.fn(async ({ where: { status } }: any) =>
        events.filter((e) => e.status === status),
      ),
    };
  };

  it('record -> PENDING; relay 1 marta publish qiladi, ikkinchi safar 0', async () => {
    const repo = makeRepo();
    const service = new OutboxService(repo as any);

    await service.record({
      aggregateType: 'order',
      aggregateId: '1',
      eventType: 'order.created',
      payload: { x: 1 },
    });
    expect(repo.events[0].status).toBe(OutboxStatus.PENDING);

    const publish = jest.fn(async () => {});
    const first = await service.relayPending(publish);
    const second = await service.relayPending(publish);

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(repo.events[0].status).toBe(OutboxStatus.PROCESSED);
  });
});
