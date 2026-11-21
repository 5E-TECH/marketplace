import { FINANCE_DB } from './database';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommonConfigModule,
  ensureSchema,
  RmqClient,
  RmqQueue,
  rmqOptions,
  ServiceHealthModule,
  shouldRunMigrations,
  typeOrmOptions,
} from '@app/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { SellerFinanceService } from './seller-finance.service';
import { WithdrawalController } from './ledger/withdrawal.controller';
import { WithdrawalService } from './ledger/withdrawal.service';
import { SettlementController } from './ledger/settlement.controller';
import { SettlementService } from './ledger/settlement.service';
import { LedgerController } from './ledger/ledger.controller';
import { LedgerService } from './ledger/ledger.service';
import { LedgerQueryService } from './ledger/ledger-query.service';
import { BalanceCheckService } from './ledger/balance-check.service';
import { CodDailyCheckService } from './ledger/cod-daily-check.service';

const entities = FINANCE_DB.entities;

@Module({
  imports: [
    CommonConfigModule,
    ScheduleModule.forRoot(),
    ServiceHealthModule.register('finance-service'),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'finance');
        return {
          ...typeOrmOptions(config, FINANCE_DB.schema, FINANCE_DB.entities),
          synchronize: false,
          migrations: FINANCE_DB.migrations,
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
    // BE-21: kunlik sverka farqi — moliya va nazoratchiga xabar
    ClientsModule.registerAsync([
      {
        name: RmqClient.NOTIFICATION,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions(
            [config.get<string>('RABBITMQ_URL')!],
            RmqQueue.NOTIFICATION,
          ),
      },
    ]),
  ],
  controllers: [
    FinanceController,
    LedgerController,
    WithdrawalController,
    SettlementController,
  ],
  providers: [
    FinanceService,
    SellerFinanceService,
    LedgerService,
    LedgerQueryService,
    BalanceCheckService,
    CodDailyCheckService,
    WithdrawalService,
    SettlementService,
  ],
})
export class FinanceModule {}
