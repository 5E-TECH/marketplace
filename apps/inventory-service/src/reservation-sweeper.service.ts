import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ReservationStatus } from './entities/inventory.enums';
import { Reservation } from './entities/reservation.entity';
import { InventoryService } from './inventory.service';

@Injectable()
export class ReservationSweeperService {
  private readonly logger = new Logger(ReservationSweeperService.name);

  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    private readonly inventoryService: InventoryService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'inventory-reservation-ttl-sweeper',
    waitForCompletion: true,
  })
  async sweepExpired(now = new Date()): Promise<number> {
    const expired = await this.reservationRepo.find({
      select: { id: true },
      where: {
        status: ReservationStatus.HELD,
        expiresAt: LessThan(now),
      },
      order: { expiresAt: 'ASC' },
      take: 100,
    });

    let released = 0;
    for (const reservation of expired) {
      try {
        if (await this.inventoryService.releaseExpired(reservation.id, now)) {
          released++;
        }
      } catch (error) {
        this.logger.error(
          `TTL reservation release xatosi (id=${reservation.id}): ${
            (error as Error).message
          }`,
        );
      }
    }
    return released;
  }
}
