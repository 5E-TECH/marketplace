import { IDENTITY_DB } from './database';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '@nestjs/microservices';
import {
  ActivityLogService,
  CommonAuthModule,
  CommonConfigModule,
  ensureSchema,
  shouldRunMigrations,
  RmqClient,
  RmqQueue,
  ServiceHealthModule,
  rmqOptions,
  typeOrmOptions,
} from '@app/common';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuditController } from './audit/audit.controller';
import { AffiliateAuthController } from './affiliate-auth/affiliate-auth.controller';
import { AffiliateAuthService } from './affiliate-auth/affiliate-auth.service';
import { OtpGuardService } from './affiliate-auth/otp-guard.service';
import { AdminSeeder } from './seed/admin.seeder';
import { AdminTeamController } from './team/admin-team.controller';
import { AdminTeamService } from './team/admin-team.service';
import { PlatformSettingsController } from './settings/platform-settings.controller';
import { PlatformSettingsService } from './settings/platform-settings.service';
import { AdminUserAccessController } from './admin-user-access/admin-user-access.controller';
import { AdminUserAccessService } from './admin-user-access/admin-user-access.service';
import { BroadcastRecipientsController } from './broadcast/broadcast-recipients.controller';
import { BroadcastRecipientsService } from './broadcast/broadcast-recipients.service';

const entities = IDENTITY_DB.entities;

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
          ...typeOrmOptions(config, IDENTITY_DB.schema, IDENTITY_DB.entities),
          migrations: IDENTITY_DB.migrations,
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [
    AuthController,
    AuditController,
    AffiliateAuthController,
    AdminTeamController,
    PlatformSettingsController,
    AdminUserAccessController,
    BroadcastRecipientsController,
  ],
  providers: [
    AuthService,
    AffiliateAuthService,
    OtpGuardService,
    AdminSeeder,
    ActivityLogService,
    AdminTeamService,
    PlatformSettingsService,
    AdminUserAccessService,
    BroadcastRecipientsService,
  ],
})
export class IdentityModule {}
