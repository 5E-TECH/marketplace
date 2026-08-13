import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { PaymentProvider, PaymentStatus } from '../enums';

export class CreatePaymentDto {
  @ApiProperty({ example: '42' })
  @IsString()
  @IsNotEmpty()
  salesOrderId: string;

  @ApiProperty({ enum: PaymentProvider })
  @IsEnum(PaymentProvider)
  provider: PaymentProvider;

  @ApiProperty({ example: 125000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;
}

export class UpsertProviderConfigDto {
  @ApiPropertyOptional({ example: 'merchant-123' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  merchantId?: string;

  @ApiPropertyOptional({ example: 'provider-secret' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  secret?: string;

  @ApiPropertyOptional({ example: 'https://checkout.provider.uz' })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(1000)
  baseUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PaymentResultDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  salesOrderId: string;

  @ApiProperty({ enum: PaymentProvider })
  provider: PaymentProvider;

  @ApiProperty()
  amount: number;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty()
  createdAt: Date;
}
