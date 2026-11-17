import { ReservationStatus } from '@app/common';
import { ReservationSweeperService } from './reservation-sweeper.service';

describe('ReservationSweeperService', () => {
  const now = new Date('2026-07-24T10:00:00.000Z');

  it('TC1: muddati o‘tgan HELD rezervatsiyani release qiladi', async () => {
    const repo = {
      find: jest.fn(async () => [{ id: '1' }]),
    };
    const inventory = {
      releaseExpired: jest.fn(async () => true),
    };
    const sweeper = new ReservationSweeperService(
      repo as never,
      inventory as never,
    );

    const released = await sweeper.sweepExpired(now);

    expect(released).toBe(1);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ReservationStatus.HELD,
        }),
      }),
    );
    expect(inventory.releaseExpired).toHaveBeenCalledWith('1', now);
  });

  it('TC2: muddati o‘tmagan rezervatsiyaga tegmaydi', async () => {
    const repo = {
      find: jest.fn(async () => []),
    };
    const inventory = {
      releaseExpired: jest.fn(),
    };
    const sweeper = new ReservationSweeperService(
      repo as never,
      inventory as never,
    );

    const released = await sweeper.sweepExpired(now);

    expect(released).toBe(0);
    expect(inventory.releaseExpired).not.toHaveBeenCalled();
  });

  describe('BE-03: cron yetakchi qulf bilan', () => {
    function setup(locked: boolean) {
      const runner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        query: jest.fn(async () => [{ locked }]),
        isTransactionActive: true,
        rollbackTransaction: jest.fn(async () => undefined),
        release: jest.fn(),
      };
      const repo = {
        find: jest.fn(async () => []),
        manager: { connection: { createQueryRunner: () => runner } },
      };
      const sweeper = new ReservationSweeperService(
        repo as never,
        { releaseExpired: jest.fn() } as never,
      );
      return { sweeper, repo, runner };
    }

    it('qulfni olgan nusxa supuradi', async () => {
      const { sweeper, repo, runner } = setup(true);
      await sweeper.sweepExpiredTick();
      expect(runner.query).toHaveBeenCalledWith(
        'SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS locked',
        [2201, 'inventory-reservation-ttl-sweeper'],
      );
      expect(repo.find).toHaveBeenCalledTimes(1);
      expect(runner.release).toHaveBeenCalled();
    });

    it('qulfni olmagan nusxa supurmaydi', async () => {
      const { sweeper, repo } = setup(false);
      await sweeper.sweepExpiredTick();
      expect(repo.find).not.toHaveBeenCalled();
    });
  });
});
