import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { runAsLeader } from '@app/common';
import { FraudService } from './fraud.service';

/**
 * Firibgarlik qoidalarini avtomatik tekshirish (TZ 7: «Har qoida admin panelida avtomatik tekshiriladi»; BE-35).
 * Har soat [taklif] — statistika ham soatbay yangilanadi (SOT-2). Bir nusxada (yetakchi qulfi, BE-03).
 */
@Injectable()
export class FraudScheduler {
  private readonly logger = new Logger(FraudScheduler.name);
  constructor(
    private readonly db: DataSource,
    private readonly fraud: FraudService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, {
    name: 'lead-fraud-detect',
    waitForCompletion: true,
  })
  async run(): Promise<void> {
    try {
      const res = await runAsLeader(this.db, 'lead-fraud-detect', () =>
        this.fraud.runDetectors(),
      );
      if (res.ran && (res.result.quality || res.result.selfOrder))
        this.logger.log(
          `Firibgarlik tekshiruvi: sifat ${res.result.quality}, o‘z raqami ${res.result.selfOrder}`,
        );
    } catch (error) {
      this.logger.error(
        `Firibgarlik tekshiruvi xato: ${(error as Error).message}`,
      );
    }
  }
}
