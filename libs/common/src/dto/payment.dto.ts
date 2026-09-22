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
  Matches,
} from 'class-validator';
import {
  PaymentProvider,
  PaymentStatus,
  PUBLIC_PAYMENT_STATUSES,
} from '../enums';

export class CreatePaymentDto {
  @ApiProperty({ example: '42' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d{0,18}$/)
  salesOrderId: string;

  @ApiProperty({ enum: PaymentProvider })
  @IsEnum(PaymentProvider)
  provider: PaymentProvider;

  @ApiProperty({ example: 125000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({
    example: 'https://marketplace.example.com/orders/42/payment-result',
    description:
      'To‘lovdan keyin provayder brauzerni qaytaradigan sahifa. Origin CORS_ORIGINS ro‘yxatida bo‘lishi shart.',
  })
  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(1000)
  returnUrl?: string;
}

export class UpsertProviderConfigDto {
  @ApiPropertyOptional({
    example: '12345',
    description: 'Click service_id (merchant_id dan alohida)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d*$/)
  @MaxLength(255)
  serviceId?: string;

  @ApiPropertyOptional({ example: 'merchant-123' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
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

  @ApiProperty({
    enum: PUBLIC_PAYMENT_STATUSES,
    description: 'Yangi to‘lov PENDING bilan qaytadi.',
  })
  status: PaymentStatus;

  @ApiProperty({ type: String, example: '2026-09-16T10:00:00.000Z' })
  createdAt: Date;

  @ApiPropertyOptional({
    type: String,
    example: 'https://checkout.paycom.uz/<base64>',
    nullable: true,
    description:
      'Provayder to‘lov sahifasi. Provayder konfiguratsiyasi to‘liq bo‘lmasa yoki to‘lov yakunlangan bo‘lsa null.',
  })
  redirectUrl: string | null;
}

export class PaymentSummaryDto {
  @ApiProperty({ example: '7' })
  paymentId: string;

  @ApiProperty({ example: '42' })
  salesOrderId: string;

  @ApiProperty({ enum: PaymentProvider })
  provider: PaymentProvider;

  @ApiProperty({ enum: PUBLIC_PAYMENT_STATUSES })
  status: PaymentStatus;

  @ApiProperty({ example: 125000 })
  amount: number;

  @ApiPropertyOptional({ type: String, example: null, nullable: true })
  paidAt: Date | string | null;

  @ApiProperty({ type: String, example: '2026-09-16T10:05:00.000Z' })
  updatedAt: Date | string;

  @ApiPropertyOptional({
    type: String,
    example: 'Tranzaksiya vaqt tugashi sababli bekor qilindi',
    nullable: true,
    description: 'Faqat CANCELLED/FAILED holatida to‘ladi.',
  })
  failureReason: string | null;
}

export interface PaymentPaidEvent {
  paymentId: string;
  salesOrderId: string;
  provider: PaymentProvider;
  amount: number;
  paidAt: string;
}

export interface RefundPaymentDto {
  paymentId?: string;
  salesOrderId: string;
  sellerOrderId: string;
  reason: string;
  idempotencyKey: string;
}

export interface RefundPaymentResult {
  paymentId: string;
  salesOrderId: string;
  provider: PaymentProvider;
  status: PaymentStatus.REFUNDED;
  providerTransactionId: string | null;
  idempotent: boolean;
}
