import { OutboxService } from './outbox.service';
import { OutboxEvent, OutboxStatus } from './outbox-event.entity';

describe('OutboxService', () => {
  const input = {
    aggregateType: 'order',
    aggregateId: '1',
    eventType: 'order.created',
    payload: { x: 1 },
  };

  it('record: manager berilsa hodisa biznes tranzaksiyasi repositoriysiga yoziladi', async () => {
    const txRepo = {
      create: jest.fn((o: object) => ({ ...o })),
      save: jest.fn(async (o: object) => o),
    };
    const manager = { getRepository: jest.fn(() => txRepo) };
    const ownRepo = { create: jest.fn(), save: jest.fn() };
    const service = new OutboxService(ownRepo as never);

    await service.record(input, manager as never);

    expect(manager.getRepository).toHaveBeenCalledWith(OutboxEvent);
    expect(txRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OutboxStatus.PENDING }),
    );
    expect(ownRepo.save).not.toHaveBeenCalled();
  });

  it('relay: qatorlar SKIP LOCKED bilan olinadi, xato bo‘lgan hodisa PENDING qoladi', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => [{ id: '1' }, { id: '2' }]),
    };
    const txRepo = {
      createQueryBuilder: jest.fn(() => qb),
      update: jest.fn(async () => undefined),
    };
    const manager = { getRepository: () => txRepo };
    const repo = {
      manager: { transaction: jest.fn((run) => run(manager)) },
    };
    const service = new OutboxService(repo as never);
    const publish = jest.fn(async (event: OutboxEvent) => {
      if (event.id === '1') throw new Error('rmq yo‘q');
    });

    await expect(service.relayPending(publish)).resolves.toBe(1);

    expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(qb.setOnLocked).toHaveBeenCalledWith('skip_locked');
    expect(txRepo.update).toHaveBeenCalledTimes(1);
    expect(txRepo.update).toHaveBeenCalledWith(
      '2',
      expect.objectContaining({ status: OutboxStatus.PROCESSED }),
    );
  });
});
