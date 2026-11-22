import type { DatabaseDefinition } from '@app/common';
import { CreateNotificationTables1722686400000 } from './migrations/1722686400000-create-notification-tables';
import { CreateTemplatesAndBroadcasts1727136000000 } from './migrations/1727136000000-create-templates-and-broadcasts';
import { CustomerSms1797811200000 } from './migrations/1797811200000-customer-sms';
import { Notification } from './entities/notification.entity';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { Broadcast } from './entities/broadcast.entity';

/**
 * notification-service bazasi (BE-04): sxema, entity va migratsiyalar bitta joyda — modul (`notification.module.ts`) va migratsiya CLI
 * (`migrate.ts`) shu ro‘yxatdan foydalanadi. Yangi migratsiya shu yerga qo‘shiladi.
 */
export const NOTIFICATION_DB: DatabaseDefinition = {
  schema: 'notification',
  entities: [
    Notification,
    NotificationDelivery,
    NotificationTemplate,
    Broadcast,
  ],
  migrations: [
    CreateNotificationTables1722686400000,
    CreateTemplatesAndBroadcasts1727136000000,
    CustomerSms1797811200000,
  ],
};
