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
import { TelegramAdapter } from './adapters/telegram.adapter';
import { DeliveryRetryService } from './delivery-retry.service';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { Notification } from './entities/notification.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { Broadcast } from './entities/broadcast.entity';
import { CreateNotificationTables1722686400000 } from './migrations/1722686400000-create-notification-tables';
import { CreateTemplatesAndBroadcasts1727136000000 } from './migrations/1727136000000-create-templates-and-broadcasts';
import { NotificationAdminController } from './notification-admin.controller';
import { NotificationTemplateService } from './notification-template.service';
import { BroadcastService } from './broadcast.service';
import { NotificationEventsController } from './notification-events.controller';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

const entities = [
  Notification,
  NotificationDelivery,
  NotificationTemplate,
  Broadcast,
];

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
          ...typeOrmOptions(config, 'notification', entities),
          migrations: [
            CreateNotificationTables1722686400000,
            CreateTemplatesAndBroadcasts1727136000000,
          ],
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
