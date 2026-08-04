import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class NotificationsQueryDto {
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

  @ApiPropertyOptional({ description: "Faqat o'qilmagan xabarlar" })
  @IsOptional()
  @IsBooleanString()
  unreadOnly?: string;
}

export class NotificationDto {
  @ApiProperty({ example: '42' })
  id: string;

  @ApiProperty({ example: 'shop_approved' })
  type: string;

  @ApiProperty({ example: "Do'kon tasdiqlandi" })
  title: string;

  @ApiProperty({ example: "Do'koningiz faol holatga o'tdi" })
  body: string;

  @ApiProperty({ example: false })
  isRead: boolean;

  @ApiProperty({ example: {}, type: Object })
  data: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

export class NotificationsPageDto {
  @ApiProperty({ type: [NotificationDto] })
  items: NotificationDto[];

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  unreadCount: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
