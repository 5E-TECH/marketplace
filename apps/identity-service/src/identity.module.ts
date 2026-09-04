import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '@nestjs/microservices';
import {
  ActivityLog,
  ActivityLogService,
  CommonAuthModule,
  CommonConfigModule,
  ensureSchema,
  RmqClient,
  RmqQueue,
  ServiceHealthModule,
  rmqOptions,
  typeOrmOptions,
} from '@app/common';
import { User } from './entities/user.entity';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuditController } from './audit/audit.controller';
import { AdminSeeder } from './seed/admin.seeder';
import { AuthSession } from './entities/auth-session.entity';
import { CreateAuthSession1721908800000 } from './migrations/1721908800000-create-auth-session';
import { CreateUsers1722776400000 } from './migrations/1722776400000-create-users';
import { AddUserShopOperator1722950000000 } from './migrations/1722950000000-add-user-shop-operator';
import { AddUserIsBlocked1722950000001 } from './migrations/1722950000001-add-user-is-blocked';
import { CreateActivityLog1722950000002 } from './migrations/1722950000002-create-activity-log';
import { CreateRecoverySupport1723100000000 } from './migrations/1723100000000-create-recovery-support';

const entities = [User, AuthSession, ActivityLog];

@Module({
  imports: [
    CommonConfigModule, // .env + Joi
    ServiceHealthModule.register('identity-service'),
    CommonAuthModule, // JwtService (JWT_SECRET)
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
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'identity'); // schema mavjud bo'lsin
        return {
          ...typeOrmOptions(config, 'identity', entities),
          migrations: [
            CreateAuthSession1721908800000,
            CreateUsers1722776400000,
            AddUserShopOperator1722950000000,
            AddUserIsBlocked1722950000001,
            CreateActivityLog1722950000002,
            CreateRecoverySupport1723100000000,
          ],
          migrationsRun: true,
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [AuthController, AuditController],
  providers: [AuthService, AdminSeeder, ActivityLogService],
})
export class IdentityModule {}
