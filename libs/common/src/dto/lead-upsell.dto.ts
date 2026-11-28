import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { IsLeadBigintId } from './lead.dto';
import { MAX_MONEY } from '../database/money.transformer';

// BE-45: upsell va cross-sell (OPR-4; TZ 5-bo‘lim 12-qoida — taklif; OPR-7 «upsell %»).
// Operator tasdiqlash qo‘ng‘irog‘ida lidga qo‘shimcha tovar qo‘shadi: narx — shu tovarning tasdiqlangan narxi (BE-09),
// bitta buyurtma, bitta posilka (BE-34 dagi ko‘p tovarli tartib). Juftlikni admin belgilaydi (admin-offer dizayni) [taklif].

export const LEAD_UPSELL_RPC = {
  /** Operator: lid uchun taklif (juftlik, vaqt oynasi, qo‘shilgan qatorlar). */
  GET: 'lead.upsell.get',
  ADD: 'lead.upsell.add',
  REMOVE: 'lead.upsell.remove',
  /** «Mijoz olmadi» — lid tarixiga qayd (dizayn: operator-upsell 6-kadr) [taklif]. */
  DECLINE: 'lead.upsell.decline',
} as const;

export const CATALOG_UPSELL_RPC = {
  /** Admin: mahsulotning upsell juftligi (bitta juftlik offer bo‘yicha — admin-offer dizayni). */
  SET_PAIR: 'catalog.product.upsell-pair.set',
} as const;

/** Qo‘shilgan qatorlar soni chegarasi: checkout ko‘p tovarli buyurtmada 50 qatordan ko‘pini rad etadi (`MAX_ORDER_LINES`). */
export const MAX_LEAD_LINES = 50;

/** POST /operator/leads/:id/items — lidga qo‘shimcha tovar. Narx yuborilmaydi: server tasdiqlangan narxni oladi (TC3). */
export class AddLeadItemDto {
  @ApiProperty({ example: '512', description: 'Qo‘shiladigan mahsulot ID si' })
  @IsLeadBigintId('productId')
  productId: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: 1000,
    description:
      'Soni. 1000 — checkout qator chegarasi (`lead-order.service.ts` tekshiruvi)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;
}

/** PUT /admin/products/:id/upsell-pair — juftlik; `null` — olib tashlash. */
export class SetUpsellPairDto {
  @ApiPropertyOptional({
    example: '512',
    nullable: true,
    type: String,
    description: 'Taklif qilinadigan mahsulot; null — juftlik olib tashlanadi',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsLeadBigintId('productId')
  productId: string | null;
}

export class LeadUpsellOfferDto {
  @ApiProperty({ example: '512' }) productId: string;
  @ApiProperty({ example: 'Oshxona tarozisi' }) name: string;
  @ApiProperty({
    example: 85000,
    nullable: true,
    type: Number,
    description: 'Tasdiqlangan narx (BE-09), bir dona; bo‘sh — tasdiqlanmagan',
  })
  price: number | null;
  @ApiProperty({
    example: 45,
    nullable: true,
    type: Number,
    description: 'Band qilinmagan qoldiq; bo‘sh — ombor javob bermadi',
  })
  stock: number | null;
  @ApiProperty({ example: 350, nullable: true, type: Number })
  weightGrams: number | null;
  @ApiProperty({ example: 'https://…/taroz.jpg', nullable: true, type: String })
  image: string | null;
  @ApiProperty({
    enum: ['IN_LEAD', 'OUT_OF_STOCK', 'NO_PRICE', 'UNAVAILABLE'],
    nullable: true,
    example: null,
    description:
      'Taklif qilib bo‘lmasa sababi: IN_LEAD — lidda bor; OUT_OF_STOCK — qoldiq 0; NO_PRICE — narx tasdiqlanmagan; ' +
      'UNAVAILABLE — sotuvdan olingan yoki sotuvchilarga yopiq',
  })
  unavailableReason:
    'IN_LEAD' | 'OUT_OF_STOCK' | 'NO_PRICE' | 'UNAVAILABLE' | null;
}

export class LeadUpsellWindowDto {
  @ApiProperty({ example: '09:00' }) from: string;
  @ApiProperty({ example: '18:00' }) to: string;
  @ApiProperty({
    example: true,
    description: 'Hozir oyna ichidami (Toshkent vaqti)',
  })
  open: boolean;
}

export class LeadUpsellLineDto {
  @ApiProperty({ example: '9001' }) itemId: string;
  @ApiProperty({ example: '512' }) productId: string;
  @ApiProperty({ example: 'Oshxona tarozisi' }) name: string;
  @ApiProperty({ example: 1 }) quantity: number;
  @ApiProperty({ example: 85000 }) unitPrice: number;
  @ApiProperty({ example: 85000 }) lineTotal: number;
}

/** GET /operator/leads/:id/upsell */
export class LeadUpsellDto {
  @ApiProperty({
    type: LeadUpsellOfferDto,
    nullable: true,
    description:
      'Admin belgilagan juftlik (admin-offer); bo‘sh — «Bu mahsulotga qo‘shimcha taklif yo‘q»',
  })
  pair: LeadUpsellOfferDto | null;

  @ApiProperty({
    type: LeadUpsellWindowDto,
    nullable: true,
    description:
      '12-qoida oynasi (`UPSELL_WINDOW`); bo‘sh — qoida yoqilmagan (TZ 5-bo‘lim: «Taklif — tasdiqlash kerak»)',
  })
  window: LeadUpsellWindowDto | null;

  @ApiProperty({
    type: [LeadUpsellLineDto],
    description: 'Qo‘shilgan qatorlar',
  })
  lines: LeadUpsellLineDto[];

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description:
      'Oxirgi «Mijoz olmadi» vaqti (shu bron ichida qayd etilgan bo‘lsa)',
  })
  declinedAt: string | null;
}

/** BE-45 TC6: operator bonusi sozlamasi (ega qarori 2026-11-28). */
export const OPERATOR_BONUS_RPC = {
  SETTINGS_GET: 'lead.operator-bonus.settings.get',
  SETTINGS_SET: 'lead.operator-bonus.settings.set',
} as const;

/** PUT /admin/operator-bonus — superadmin. */
export class UpdateOperatorBonusSettingsDto {
  @ApiProperty({
    example: 10000,
    minimum: 0,
    description:
      'Har qo‘shilgan boshqa tovar uchun operatorga bonus, so‘m; 0 — bonus hisoblanmaydi. Mijoz tovarni olganda, shu paytdagi ' +
      'summa bilan yoziladi (keyin o‘zgartirilsa eski bonuslar o‘zgarmaydi). Ish haqi bilan to‘lanadi (TZ 2.5)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  upsellBonus: number;
}

export class OperatorBonusSettingsDto {
  @ApiProperty({ example: 10000 }) upsellBonus: number;
  @ApiProperty({ example: '17', nullable: true, type: String })
  updatedBy: string | null;
  @ApiProperty({
    example: '2026-11-28T09:00:00.000Z',
    nullable: true,
    type: String,
  })
  updatedAt: string | null;
}
