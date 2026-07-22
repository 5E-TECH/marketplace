import { RmqOptions, Transport } from '@nestjs/microservices';

/** RMQ navbat nomlari (client va server bir xil nomni ishlatishi shart). */
export const RmqQueue = {
  ECHO: 'echo_queue',
  IDENTITY: 'identity_queue',
  CATALOG: 'catalog_queue',
  INVENTORY: 'inventory_queue',
  CHECKOUT: 'checkout_queue',
  PAYMENT: 'payment_queue',
  FINANCE: 'finance_queue',
  INTEGRATION: 'integration_queue',
  NOTIFICATION: 'notification_queue',
  SEARCH: 'search_queue',
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
} as const;

/**
 * RMQ ulanish sozlamalari — ham client (gateway), ham server (microservice) uchun.
 * Bitta joyda, shuning uchun ikki tomon doim mos bo'ladi.
 */
export function rmqOptions(urls: string[], queue: string): RmqOptions {
  return {
    transport: Transport.RMQ,
    options: {
      urls,
      queue,
      queueOptions: { durable: true },
    },
  };
}
