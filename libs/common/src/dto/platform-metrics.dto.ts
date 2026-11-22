import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

/**
 * Admin ko‘rsatkichlari (BE-46; TZ 9-bo‘lim, 6.10 ADM-5; dizayn `admin-panel`, FE-22). Har son o‘z hodisa kunida
 * (BE-28 qoidasi): lid — kelgan kun, tasdiq — tasdiq kuni, sotuv va rad — buyurtma hodisasi kuni, klik — klik kuni.
 */
export enum PlatformMetricsGroupBy {
  DAY = 'DAY',
  AFFILIATE = 'AFFILIATE',
  OPERATOR = 'OPERATOR',
  OFFER = 'OFFER',
}

export const PLATFORM_METRICS_RPC = {
  LEADS: 'lead.stats.platform',
  FINANCE: 'finance.metrics.platform',
  /** Sotuvchi daromadi ledgerdan (BE-28 bilan bir xil manba): kun, sotuvchi yoki offer bo‘yicha. */
  AFFILIATE_INCOME: 'finance.metrics.affiliate-income',
} as const;

/** `finance.metrics.affiliate-income` so‘rovi va javobi (lead-service chaqiradi). */
export interface PlatformAffiliateIncomeQuery {
  from: string;
  to: string;
  groupBy: 'DAY' | 'AFFILIATE' | 'OFFER';
}
export interface PlatformAffiliateIncomeResult {
  /** Guruh kaliti → summa (so‘m); `total` — davr jami. */
  rows: Array<{ key: string; amount: number }>;
  total: number;
}

export class PlatformMetricsQueryDto {
  @ApiProperty({ example: '2026-12-01', description: 'Toshkent kuni (kiradi)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @ApiProperty({ example: '2026-12-07', description: 'Toshkent kuni (kiradi)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;

  @ApiPropertyOptional({ enum: PlatformMetricsGroupBy })
  @IsOptional()
  @IsIn(Object.values(PlatformMetricsGroupBy))
  groupBy?: PlatformMetricsGroupBy;
}

/** lead-service hisobi (bir kesim qatori). Operator kesimida — BE-28 operator statistikasi qoidalari. */
export class PlatformLeadMetricsRowDto {
  @ApiProperty({
    description:
      'Kun, sotuvchi, operator yoki offer (mahsulot) ID si; jami — TOTAL',
  })
  key: string;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Operator kesimida null',
  })
  clicks: number | null;
  @ApiProperty({ nullable: true, type: Number }) leads: number | null;
  @ApiProperty({ nullable: true, type: Number }) invalid: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Dublikat (birlashtirilgan)',
  })
  duplicates: number | null;
  @ApiProperty({ nullable: true, type: Number }) validLeads: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: '«Aloqa bo‘lmadi»',
  })
  noContact: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Operator kesimida: urinishlar',
  })
  attempts: number | null;
  @ApiProperty() confirmed: number;
  @ApiProperty({ description: 'Kunlik sotuv: mijoz olgan buyurtmalar' })
  delivered: number;
  @ApiProperty() refused: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: '(barcha − yaroqsiz − dublikat) / barcha, %',
  })
  validLeadRate: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Tasdiqlangan / yaroqli, % (operatorda — ishlagan yaroqli)',
  })
  approveRate: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Olgan / (olgan + rad), %',
  })
  saleRate: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: '«Aloqa bo‘lmadi» / yaroqli, %',
  })
  lostLeadRate: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Birinchi qo‘ng‘iroq, median, daqiqa',
  })
  firstCallMedianMinutes: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'O‘rtacha chek: tovar narxi (yetkazishsiz), so‘m',
  })
  averageCheck: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Sotuvchi daromadi, so‘m — ledgerdan (BE-28 bilan bir xil): yetkazilgan kunda +, qaytarilgan kunda −; asosiy sayt sotuvi kirmaydi',
  })
  affiliateIncome: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'EPC: daromad / kliklar, so‘m',
  })
  epc: number | null;
}

export class PlatformLeadMetricsDto {
  @ApiProperty({ type: [PlatformLeadMetricsRowDto] })
  rows: PlatformLeadMetricsRowDto[];
  @ApiProperty({ type: PlatformLeadMetricsRowDto })
  totals: PlatformLeadMetricsRowDto;
}

/** finance hisobi (kun bo‘yicha). */
export class PlatformFinanceMetricsRowDto {
  @ApiProperty() key: string;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Hissa bitta sotuvdan [taklif]: platforma ulushi / sotuvlar',
  })
  contributionPerSale: number | null;
  @ApiProperty({
    description:
      'Platforma ulushi yig‘indisi (yetkazilgan, rad to‘lovi, qaytarish), so‘m',
  })
  platformShare: number;
  @ApiProperty({
    description: 'Sverka farqi: hal qilinmagan, so‘m (Elchi − tizim)',
  })
  reconciliationDiff: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Pul yechish: so‘rovdan to‘lovgacha, median, soat',
  })
  withdrawalMedianHours: number | null;
}

export class PlatformFinanceMetricsDto {
  @ApiProperty({ type: [PlatformFinanceMetricsRowDto] })
  rows: PlatformFinanceMetricsRowDto[];
  @ApiProperty({ type: PlatformFinanceMetricsRowDto })
  totals: PlatformFinanceMetricsRowDto;
}

export class PlatformMetricsDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ enum: PlatformMetricsGroupBy })
  groupBy: PlatformMetricsGroupBy;
  @ApiProperty({ type: PlatformLeadMetricsDto }) leads: PlatformLeadMetricsDto;
  @ApiProperty({
    type: PlatformFinanceMetricsDto,
    nullable: true,
    description: 'Faqat kun kesimida',
  })
  finance: PlatformFinanceMetricsDto | null;
}
