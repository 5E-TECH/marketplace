import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSupportTicketDto {
  @ApiProperty({ example: 'Buyurtma yetib kelmadi' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject: string;
  @ApiProperty({ example: 'Buyurtma #123 bo‘yicha yordam kerak' })
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  message: string;
  @ApiPropertyOptional({ example: '123' })
  @IsOptional()
  @IsString()
  orderId?: string;
}
export class SupportMessageDto {
  @ApiProperty({ example: 'Iltimos, holatini tekshirib bering' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message: string;
}
export class SupportTicketsQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] })
  @IsOptional()
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
  status?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
