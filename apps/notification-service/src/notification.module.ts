import { NOTIFICATION_DB } from './database';
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
import { EmailAdapter } from './adapters/email.adapter';
import { NOTIFICATION_ADAPTERS } from './adapters/notification-adapter';
import { SmsAdapter } from './adapters/sms.adapter';
import { SiteOrderSmsController } from './site-order-sms.controller';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { DeliveryRetryService } from './delivery-retry.service';
import { NotificationAdminController } from './notification-admin.controller';
import { NotificationTemplateService } from './notification-template.service';
import { BroadcastService } from './broadcast.service';
import { NotificationEventsController } from './notification-events.controller';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

const entities = NOTIFICATION_DB.entities;

@Module({
  imports: [
    CommonConfigModule,
    ServiceHealthModule.register('notification-service'),
    ScheduleModule.forRoot(),
    // C6.8 — ommaviy xabar qabul qiluvchilari identity'dan olinadi.
    ClientsModule.registerAsync([
      {
        name: RmqClient.IDENTITY,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.IDENTITY),
      },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'notification');
        return {
          ...typeOrmOptions(
            config,
            NOTIFICATION_DB.schema,
            NOTIFICATION_DB.entities,
          ),
          migrations: NOTIFICATION_DB.migrations,
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [
    NotificationController,
    NotificationEventsController,
    NotificationAdminController,
    SiteOrderSmsController,
  ],
  providers: [
    NotificationService,
    NotificationTemplateService,
    BroadcastService,
    DeliveryRetryService,
    EmailAdapter,
    TelegramAdapter,
    SmsAdapter,
    {
      provide: NOTIFICATION_ADAPTERS,
      inject: [EmailAdapter, TelegramAdapter, SmsAdapter],
      useFactory: (...adapters) => adapters,
    },
  ],
})
export class NotificationModule {}
