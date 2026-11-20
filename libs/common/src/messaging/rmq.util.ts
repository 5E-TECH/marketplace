import { RmqOptions, Transport } from '@nestjs/microservices';

/**
 * RMQ navbat nomlari (client va server bir xil nomni ishlatishi shart).
 *
 * BE-02: `_v2` — dead-letter (DLQ) argumentlari bilan yangi navbatlar. Mavjud navbatga DLX argumentini qo‘shib
 * bo‘lmaydi (RabbitMQ PRECONDITION_FAILED beradi), shuning uchun yangi nom. Eski navbatlarda qolgan xabarlar
 * `scripts/rmq-migrate-v2.mjs` bilan ko‘chiriladi va eski navbat o‘chiriladi.
 */
export const RmqQueue = {
  ECHO: 'echo_queue_v2',
  IDENTITY: 'identity_queue_v2',
  CATALOG: 'catalog_queue_v2',
  INVENTORY: 'inventory_queue_v2',
  CHECKOUT: 'checkout_queue_v2',
  PAYMENT: 'payment_queue_v2',
  FINANCE: 'finance_queue_v2',
  INTEGRATION: 'integration_queue_v2',
  NOTIFICATION: 'notification_queue_v2',
  SEARCH: 'search_queue_v2',
  FILE: 'file_queue_v2',
  LEAD: 'lead_queue_v2',
} as const;

/** Injection token'lari (gateway ClientsModule uchun). */
export const RmqClient = {
  ECHO: 'ECHO_SERVICE',
  IDENTITY: 'IDENTITY_SERVICE',
  CATALOG: 'CATALOG_SERVICE',
  INVENTORY: 'INVENTORY_SERVICE',
  CHECKOUT: 'CHECKOUT_SERVICE',
  PAYMENT: 'PAYMENT_SERVICE',
  FINANCE: 'FINANCE_SERVICE',
  INTEGRATION: 'INTEGRATION_SERVICE',
  NOTIFICATION: 'NOTIFICATION_SERVICE',
  SEARCH: 'SEARCH_SERVICE',
  FILE: 'FILE_SERVICE',
  LEAD: 'LEAD_SERVICE',
} as const;

/** BE-02: navbatning dead-letter navbati — ishlanmagan xabar shu yerda ko‘rinadi. */
export function deadLetterQueue(queue: string): string {
  return `${queue}.dlq`;
}

/** BE-02: kechiktirilgan qayta urinish navbati — TTL tugagach xabar asosiy navbatga qaytadi. */
export function retryQueue(queue: string): string {
  return `${queue}.retry`;
}

/** DLQ da xabar 14 kun turadi [taklif]: ko‘rib chiqish uchun yetarli, shaxsiy ma’lumot cheksiz saqlanmaydi. */
export const RMQ_DLQ_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function rmqDeadLetterQueueOptions() {
  return { durable: true, messageTtl: RMQ_DLQ_TTL_MS };
}

export function rmqRetryQueueOptions(queue: string, delayMs: number) {
  return {
    durable: true,
    messageTtl: delayMs,
    deadLetterExchange: '',
    deadLetterRoutingKey: queue,
  };
}

/**
 * Navbat argumentlari — client ham, server ham AYNAN shuni e’lon qiladi (argumentlar farq qilsa RabbitMQ
 * PRECONDITION_FAILED beradi): doimiy navbat; rad etilgan xabar standart exchange orqali `<navbat>.dlq` ga.
 */
export function rmqQueueOptions(queue: string) {
  return {
    durable: true,
    deadLetterExchange: '',
    deadLetterRoutingKey: deadLetterQueue(queue),
  };
}

/**
 * Bir iste’molchiga bir vaqtda tasdiqlanmagan xabarlar soni [taklif]. Avval cheklovsiz edi (noAck); servislar bir-
 * birini RPC bilan chaqiradi (catalog↔checkout va b.) — kichik chegara ikki tomonni ham to‘ldirib, kutishga olib
 * kelardi. Shuning uchun katta.
 */
export const RMQ_PREFETCH_COUNT = 200;

/**
 * RMQ client sozlamalari (gateway va servislararo `ClientsModule`). Xabarlar doimiy (persistent): RabbitMQ qayta
 * ishga tushsa navbatdagi xabarlar saqlanadi (BE-02 TC2). Server tomoni — `rmqServer` (`reliable-rmq.server.ts`).
 */
export function rmqOptions(urls: string[], queue: string): RmqOptions {
  return {
    transport: Transport.RMQ,
    options: {
      urls,
      queue,
      queueOptions: rmqQueueOptions(queue),
      persistent: true,
    },
  };
}
