import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommonConfigModule,
  ensureSchema,
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
import { CreateNotificationTables1722686400000 } from './migrations/1722686400000-create-notification-tables';
import { NotificationEventsController } from './notification-events.controller';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

const entities = [Notification, NotificationDelivery];

@Module({
  imports: [
    CommonConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'notification');
        return {
          ...typeOrmOptions(config, 'notification', entities),
          migrations: [CreateNotificationTables1722686400000],
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [NotificationController, NotificationEventsController],
  providers: [
    NotificationService,
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
