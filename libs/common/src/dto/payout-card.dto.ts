import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { WithdrawalStatus } from './withdrawal.dto';

/**
 * BE-32 (TZ MOL-6, T02:85): sotuvchi kartasiga pul o‘tkazish. Karta provayder sahifasida kiritiladi — bizga faqat
 * provayder tokeni va niqob keladi; to‘liq karta raqami hech qachon kelmaydi va saqlanmaydi. Provayder — EQ-08.
 */
export const PAYOUT_CARD_RPC = {
  GET: 'finance.payout-card.get',
  SESSION: 'finance.payout-card.session',
  REMOVE: 'finance.payout-card.remove',
} as const;

/** Gateway webhookidan finance ga (token gateway da shifrlanadi — navbatda ochiq token yo‘q). */
export const PAYOUT_EVENTS = {
  CARD_BOUND: 'finance.payout.card-bound',
  STATUS: 'finance.payout.status',
} as const;

/** Kartaga yuborilgan pul provayderda rad etildi — sotuvchiga va moliyaga. */
export const WITHDRAWAL_FAILED_EVENT = 'finance.withdrawal.failed';
/** 24 soatdan beri to‘lanmagan so‘rov (T01:498) — moliyaga. */
export const WITHDRAWAL_OVERDUE_EVENT = 'finance.withdrawal.overdue';

/** Niqob: faqat birinchi 4 va oxirgi 4 raqam (`8600 **** **** 1234`). Boshqa shakl qabul qilinmaydi (TC3). */
export const CARD_MASK = /^\d{4} \*{4} \*{4} \d{4}$/;
/** Provayder tokeni va hodisa ID si — chop etiladigan ASCII [taklif]. */
export const PAYOUT_TOKEN = /^[\x21-\x7e]{8,300}$/;
export const PAYOUT_EVENT_ID = /^[A-Za-z0-9._:-]{1,200}$/;
/** Bitta so‘rov — bitta chiqim: `payoutRef` = `wd-<so‘rov ID>`. */
export const PAYOUT_REF = /^wd-\d{1,19}$/;

export enum PayoutCardSystem {
  UZCARD = 'UZCARD',
  HUMO = 'HUMO',
}

export class PayoutCardDto {
  @ApiProperty({ example: '8600 **** **** 1234' }) mask: string;

  @ApiProperty({ enum: PayoutCardSystem, nullable: true, example: 'UZCARD' })
  system: PayoutCardSystem | null;

  @ApiProperty({
    example: 'AZIZA KARIMOVA',
    nullable: true,
    type: String,
    description: 'Karta egasi (provayder bersa)',
  })
  holderName: string | null;

  @ApiProperty({ example: '2026-12-21T08:00:00.000Z' }) boundAt: Date;
}

export class PayoutCardInfoDto {
  @ApiProperty({
    example: false,
    description:
      'Kartaga avtomatik to‘lov yoqilganmi (provayder sozlangan). false — moliya pulni qo‘lda o‘tkazadi',
  })
  enabled: boolean;

  @ApiProperty({ type: PayoutCardDto, nullable: true })
  card: PayoutCardDto | null;
}

export class PayoutCardSessionDto {
  @ApiProperty({
    example: 'https://pay.example.uz/bind/7c1e',
    description: 'Provayder sahifasi: sotuvchi kartani shu yerda kiritadi',
  })
  url: string;

  @ApiProperty({ example: '2026-12-21T08:15:00.000Z' }) expiresAt: Date;
}

/** Provayder webhooki (BE-32). Imzo — `X-Payout-Signature` (HMAC-SHA256, xom tana). */
export class PayoutWebhookDto {
  @ApiProperty({ enum: ['card.bound', 'payout.status'] })
  @IsIn(['card.bound', 'payout.status'])
  type: 'card.bound' | 'payout.status';

  @ApiProperty({ example: 'evt-8f1c', description: 'Hodisa ID si (takrorsiz)' })
  @Matches(PAYOUT_EVENT_ID)
  eventId: string;

  @ApiPropertyOptional({ description: '`card.bound`: sessiya ID si' })
  @ValidateIf((dto: PayoutWebhookDto) => dto.type === 'card.bound')
  @IsUUID()
  sessionRef?: string;

  @ApiPropertyOptional({ description: '`card.bound`: provayder karta tokeni' })
  @ValidateIf((dto: PayoutWebhookDto) => dto.type === 'card.bound')
  @Matches(PAYOUT_TOKEN)
  cardToken?: string;

  @ApiPropertyOptional({ example: '8600 **** **** 1234' })
  @ValidateIf((dto: PayoutWebhookDto) => dto.type === 'card.bound')
  @Matches(CARD_MASK)
  mask?: string;

  @ApiPropertyOptional({ enum: PayoutCardSystem })
  @IsOptional()
  @IsIn(Object.values(PayoutCardSystem))
  system?: PayoutCardSystem;

  @ApiPropertyOptional({ example: 'AZIZA KARIMOVA' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  holderName?: string;

  @ApiPropertyOptional({ example: 'wd-12', description: '`payout.status`' })
  @ValidateIf((dto: PayoutWebhookDto) => dto.type === 'payout.status')
  @Matches(PAYOUT_REF)
  payoutRef?: string;

  @ApiPropertyOptional({ enum: ['SUCCESS', 'PENDING', 'FAILED'] })
  @ValidateIf((dto: PayoutWebhookDto) => dto.type === 'payout.status')
  @IsIn(['SUCCESS', 'PENDING', 'FAILED'])
  status?: 'SUCCESS' | 'PENDING' | 'FAILED';

  @ApiPropertyOptional({ example: 'Karta bloklangan' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export interface PayoutCardBoundEvent {
  eventId: string;
  sessionRef: string;
  /** `PAYOUT_SECRET_KEY` bilan shifrlangan token (gateway shifrlaydi). */
  tokenCipher: string;
  mask: string;
  system: PayoutCardSystem | null;
  holderName: string | null;
}

export interface PayoutStatusEvent {
  eventId: string;
  payoutRef: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  reason: string | null;
}

export interface WithdrawalFailedEvent {
  withdrawalId: string;
  affiliateId: string;
  amount: number;
  net: number;
  cardMask: string | null;
  reason: string;
}

export interface WithdrawalOverdueEvent {
  withdrawals: Array<{
    id: string;
    affiliateId: string;
    amount: number;
    status: WithdrawalStatus;
    createdAt: string;
  }>;
}

/** Moliya `PAYING` dagi so‘rovni provayder kabinetida tekshirib yopadi. */
export class PayoutResultDto {
  @ApiProperty({
    enum: ['PAID', 'FAILED'],
    description:
      '`PAID` — pul kartaga tushgan (jurnal yoziladi); `FAILED` — tushmagan (pul «Mavjud» da qoladi)',
  })
  @IsIn(['PAID', 'FAILED'])
  result: 'PAID' | 'FAILED';

  @ApiProperty({ example: 'Provayder kabinetida: to‘lov o‘tgan, 21.12 10:42' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}
