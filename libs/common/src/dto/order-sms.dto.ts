import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** BE-25 (FE-26): buyurtma kartasidagi «SMS» jurnali va qo‘lda qayta yuborish — notification-service. */
export const ORDER_SMS_RPC = {
  LIST: 'notification.order-sms.list',
  RESEND: 'notification.order-sms.resend',
} as const;

/** Mijozga avtomatik buyurtma SMS lari (BE-24, BUY-6) — `notification.type` qiymatlari. */
export const ORDER_SMS_TYPES = [
  'order_confirmed',
  'order_in_transit',
  'order_delivered',
] as const;
export type OrderSmsType = (typeof ORDER_SMS_TYPES)[number];

/** Frontend jurnal holatlari (`JournalState`) dan: yuborildi, navbatda, yuborilmadi. */
export const ORDER_SMS_STATES = ['SENT', 'PENDING', 'FAILED'] as const;
export type OrderSmsState = (typeof ORDER_SMS_STATES)[number];

export class OrderSmsDto {
  @ApiProperty({ enum: ORDER_SMS_TYPES, example: 'order_confirmed' })
  template: OrderSmsType;

  @ApiProperty({
    example: 'Buyurtma tasdiqlandi',
    description: 'Qo‘lda qayta yuborilganida — «… — qayta yuborildi»',
  })
  title: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-12-01T09:14:20.000Z',
    description: 'Yuborilgan vaqt; hali yuborilmagan bo‘lsa yaratilgan vaqt',
  })
  at: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Izoh: navbatda qayta urinilmoqda yoki yuborilmadi',
  })
  detail: string | null;

  @ApiProperty({ enum: ORDER_SMS_STATES, example: 'SENT' })
  state: OrderSmsState;
}

/** `POST /admin/orders/{id}/sms/resend` */
export class OrderSmsResendRequestDto {
  @ApiProperty({
    example: 'order_confirmed',
    description:
      'Qaysi SMS: shablon kodi (`order_confirmed | order_in_transit | order_delivered`) yoki jurnaldagi `title`',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  template: string;
}
