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
import { FinanceSettingsController } from './ledger/finance-settings.controller';
import { FinanceSettingsService } from './ledger/finance-settings.service';
import { SettlementService } from './ledger/settlement.service';
import { WholesalerBalanceService } from './ledger/wholesaler-balance.service';
import { PlatformMetricsService } from './ledger/platform-metrics.service';
import { ReconciliationController } from './ledger/reconciliation.controller';
import { RemittanceService } from './ledger/remittance.service';
import { SettlementResponseController } from './ledger/settlement-response.controller';
import { SettlementResponseService } from './ledger/settlement-response.service';
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
    ReconciliationController,
    SettlementResponseController,
    FinanceSettingsController,
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
    WholesalerBalanceService,
    PlatformMetricsService,
    RemittanceService,
    SettlementResponseService,
    FinanceSettingsService,
  ],
})
export class FinanceModule {}
