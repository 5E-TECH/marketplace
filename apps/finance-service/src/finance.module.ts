import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommonConfigModule,
  ensureSchema,
  shouldRunMigrations,
  typeOrmOptions,
} from '@app/common';
import { Commission } from './entities/commission.entity';
import { Payout } from './entities/payout.entity';
import { SellerLedger } from './entities/seller-ledger.entity';
import { CodReconciliation } from './entities/cod-reconciliation.entity';
import { CreateCodReconciliation1724932800000 } from './migrations/1724932800000-create-cod-reconciliation';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { CreateFinanceTables1724673600000 } from './migrations/1724673600000-create-finance-tables';

const entities = [SellerLedger, Payout, Commission, CodReconciliation];

@Module({
  imports: [
    CommonConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'finance');
        return {
          ...typeOrmOptions(config, 'finance', entities),
          synchronize: false,
          migrations: [
            CreateFinanceTables1724673600000,
            CreateCodReconciliation1724932800000,
          ],
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
