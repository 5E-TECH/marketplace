import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonConfigModule, ensureSchema, typeOrmOptions } from '@app/common';
import { Commission } from './entities/commission.entity';
import { Payout } from './entities/payout.entity';
import { SellerLedger } from './entities/seller-ledger.entity';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { CreateFinanceTables1724673600000 } from './migrations/1724673600000-create-finance-tables';

const entities = [SellerLedger, Payout, Commission];

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
          migrations: [CreateFinanceTables1724673600000],
          migrationsRun: true,
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
