import { ReservationStatus } from './entities/inventory.enums';
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
});
