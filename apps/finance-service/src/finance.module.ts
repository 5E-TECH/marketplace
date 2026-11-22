import { FINANCE_DB } from './database';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommonConfigModule,
  ensureSchema,
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
import { PlatformMetricsService } from './ledger/platform-metrics.service';
import { ReconciliationController } from './ledger/reconciliation.controller';
import { RemittanceService } from './ledger/remittance.service';
import { SettlementResponseController } from './ledger/settlement-response.controller';
import { SettlementResponseService } from './ledger/settlement-response.service';
import { LedgerController } from './ledger/ledger.controller';
import { LedgerService } from './ledger/ledger.service';
import { LedgerQueryService } from './ledger/ledger-query.service';
import { BalanceCheckService } from './ledger/balance-check.service';

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
  ],
  controllers: [
    FinanceController,
    LedgerController,
    WithdrawalController,
    SettlementController,
    ReconciliationController,
    SettlementResponseController,
  ],
  providers: [
    FinanceService,
    SellerFinanceService,
    LedgerService,
    LedgerQueryService,
    BalanceCheckService,
    WithdrawalService,
    SettlementService,
    PlatformMetricsService,
    RemittanceService,
    SettlementResponseService,
  ],
})
export class FinanceModule {}
