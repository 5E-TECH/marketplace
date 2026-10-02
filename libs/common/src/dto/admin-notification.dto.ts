import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * C6.8 — ommaviy xabar auditoriyasi. `all` — xaridor, sotuvchi va operator
 * (adminlar kirmaydi). Faqat faol, bloklanmagan, o'chirilmagan foydalanuvchi.
 */
export const BROADCAST_AUDIENCES = ['all', 'sellers', 'buyers'] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

/**
 * In-app (ilova ichidagi xabar) har doim yoziladi. Tashqi kanallar ixtiyoriy:
 * SMS pulli, shuning uchun sukut bo'yicha yuborilmaydi. Telegram chat id
 * foydalanuvchi profilida saqlanmaydi — ommaviy xabarda yo'q.
 */
export const BROADCAST_CHANNELS = ['sms', 'email'] as const;
export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number];

export const BROADCAST_STATUSES = [
  'QUEUED',
  'SENDING',
  'DONE',
  'FAILED',
] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export class UpdateNotificationTemplateDto {
  @ApiProperty({ example: 'Do‘kon tasdiqlandi', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({
    example: '{shopName} do‘koningiz faol holatga o‘tdi.',
    maxLength: 2000,
    description:
      'O‘zgaruvchilar `{nomi}` ko‘rinishida; faqat shablon ro‘yxatidagilari',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;
}

export class NotificationTemplateDto {
  @ApiProperty({ example: 'shop_approved' }) key: string;
  @ApiProperty({ example: 'Do‘kon tasdiqlandi' }) name: string;
  @ApiProperty({ example: 'Admin do‘konni tasdiqlaganda sotuvchiga' })
  description: string;
  @ApiProperty({
    example: { shopName: 'Do‘kon nomi' },
    description: 'Shablonda ishlatish mumkin bo‘lgan o‘zgaruvchilar',
  })
  variables: Record<string, string>;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ description: 'false — standart matn' }) customized: boolean;
  @ApiProperty() defaultTitle: string;
  @ApiProperty() defaultBody: string;
  @ApiProperty({ nullable: true, type: String }) updatedAt: string | null;
}

export class BroadcastPreviewDto {
  @ApiProperty({ enum: BROADCAST_AUDIENCES, example: 'sellers' })
  @IsIn(BROADCAST_AUDIENCES)
  audience: BroadcastAudience;

  @ApiPropertyOptional({
    enum: BROADCAST_CHANNELS,
    isArray: true,
    example: [],
    description: 'In-app doim. Qo‘shimcha kanallar ixtiyoriy.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(BROADCAST_CHANNELS, { each: true })
  channels?: BroadcastChannel[];

  @ApiProperty({ example: 'Yangi aksiya', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'Bugundan 20% chegirma!', maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;
}

export class BroadcastSendDto extends BroadcastPreviewDto {
  @ApiProperty({
    description:
      '`POST /admin/broadcast/preview` javobidagi token — aynan ko‘rib chiqilgan xabar yuboriladi',
  })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  previewToken: string;
}

export class BroadcastPreviewResultDto {
  @ApiProperty({ enum: BROADCAST_AUDIENCES }) audience: BroadcastAudience;
  @ApiProperty({ enum: BROADCAST_CHANNELS, isArray: true })
  channels: BroadcastChannel[];
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ example: 42 }) recipientsCount: number;
  @ApiProperty({ description: 'Yuborishda qaytarilishi shart' })
  previewToken: string;
}

export class BroadcastDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: BROADCAST_AUDIENCES }) audience: BroadcastAudience;
  @ApiProperty({ enum: BROADCAST_CHANNELS, isArray: true })
  channels: BroadcastChannel[];
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty() recipientsCount: number;
  @ApiProperty() sentCount: number;
  @ApiProperty({ enum: BROADCAST_STATUSES }) status: BroadcastStatus;
  @ApiProperty({ nullable: true, type: String }) createdBy: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty({ nullable: true, type: String }) finishedAt: string | null;
  @ApiProperty({ nullable: true, type: String }) lastError: string | null;
  @ApiPropertyOptional({
    description:
      'true — shu token bilan allaqachon yuborilgan (ikki marta bosish)',
  })
  idempotent?: boolean;
}

export class BroadcastsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class BroadcastsPageDto {
  @ApiProperty({ type: [BroadcastDto] }) items: BroadcastDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
