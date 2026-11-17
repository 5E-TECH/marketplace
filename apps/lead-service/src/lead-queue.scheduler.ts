import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LeadQueueService } from './lead-queue.service';

/** Har daqiqada navbatni tozalaydi (5, 8, 2-qoidalar). Namuna: inventory `reservation-sweeper.service.ts`. */
@Injectable()
export class LeadQueueScheduler {
  private readonly logger = new Logger(LeadQueueScheduler.name);
  constructor(private readonly queue: LeadQueueService) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'lead-queue-sweep',
    waitForCompletion: true,
  })
  async run(): Promise<void> {
    try {
      await this.queue.sweep();
    } catch (error) {
      this.logger.error(`Navbat tozalash xato: ${(error as Error).message}`);
    }
  }
}
