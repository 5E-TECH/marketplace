import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { IsLeadBigintId, LeadVariant } from './lead.dto';

/**
 * BE-39: S1 va S3 sinovi hisoboti (LID-8; `sinov-s1-s3.md`). Hal qiluvchi raqam — 1000 tashrifga qabul qilingan
 * posilkalardan tushgan pul. Faqat admin (T02:180: eksport faqat admin).
 */
export class VariantReportQueryDto {
  @ApiProperty({
    example: '2027-01-01',
    description: 'Toshkent kuni; tashrif va ariza shu davrda',
  })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2027-01-31', description: 'Toshkent kuni (kiradi)' })
  @IsDateString()
  to: string;

  @ApiPropertyOptional({ example: '501', description: 'Bitta mahsulot' })
  @IsOptional()
  @IsLeadBigintId('productId')
  productId?: string;
}

export class VariantReportRowDto {
  @ApiProperty({ enum: LeadVariant, example: LeadVariant.S1 })
  variant: LeadVariant;

  @ApiProperty({
    example: '501',
    nullable: true,
    type: String,
    description: 'Bo‘sh — variantning hamma mahsuloti (jami qatori)',
  })
  productId: string | null;

  @ApiProperty({ example: 'Simsiz quloqchinlar' }) productName: string;
  @ApiProperty({ example: 4210, description: 'Tashrif (klik)' })
  visits: number;

  @ApiProperty({
    example: 312,
    description: 'Ariza: hamma ariza, dublikat birinchi arizaning variantida',
  })
  applications: number;

  @ApiProperty({ example: 18 }) duplicates: number;
  @ApiProperty({
    example: 5.8,
    nullable: true,
    type: Number,
    description: 'Dublikat foizi (bir xona aniqlikda)',
  })
  duplicateRate: number | null;

  @ApiProperty({ example: 260 }) valid: number;
  @ApiProperty({ example: 121 }) confirmed: number;
  @ApiProperty({ example: 115, description: 'Elchi’ga topshirilgan' })
  shipped: number;

  @ApiProperty({ example: 82, description: 'Qabul qilingan (yetkazildi)' })
  accepted: number;

  @ApiProperty({ example: 2, description: 'Qabul qilingan, keyin qaytarilgan' })
  returned: number;

  @ApiProperty({
    example: 21320000,
    description:
      'Qabul qilingan va qaytarilmagan posilkalardan tushgan pul, so‘m: lid narxi × miqdor',
  })
  amount: number;

  @ApiProperty({
    example: 5064133,
    nullable: true,
    type: Number,
    description: '1000 tashrifga tushgan pul, so‘m (hal qiluvchi raqam)',
  })
  amountPer1000Visits: number | null;

  @ApiProperty({
    example: false,
    nullable: true,
    type: Boolean,
    description:
      'Jami qatorida: variant maqsadga yetdimi (qabul qilingan ≥ targetAcceptedPerVariant); mahsulot qatorida bo‘sh',
  })
  targetReached: boolean | null;

  @ApiProperty({
    example: { TOO_EXPENSIVE: 40, NOT_NEEDED: 22 },
    description: 'Rad sabablari',
  })
  rejectReasons: Record<string, number>;
}

export class VariantReportDto {
  @ApiProperty({ example: '2027-01-01' }) from: string;
  @ApiProperty({ example: '2027-01-31' }) to: string;
  @ApiProperty({ example: '2027-02-01T09:00:00.000Z' }) generatedAt: Date;
  @ApiProperty({
    type: [VariantReportRowDto],
    description: 'Avval jami qatorlar (har variant), keyin variant × mahsulot',
  })
  rows: VariantReportRowDto[];

  @ApiProperty({
    example: 400,
    description:
      'Har variantda qabul qilingan posilka maqsadi (ega qarori 2026-11-18; sinov-s1-s3.md «Qancha kerak»). ' +
      'Davr sinov boshidan olinadi',
  })
  targetAcceptedPerVariant: number;

  @ApiProperty({
    example: false,
    description:
      'Ikkala variant ham maqsadga yetdi — sinov natijasini o‘qish mumkin',
  })
  targetReached: boolean;

  @ApiProperty({
    example:
      'Sinov oldindan belgilangan posilka soniga yetguncha natijaga qarab to‘xtatilmaydi (sinov-s1-s3.md)',
  })
  note: string;
}
