/**
 * Sotuvchi daromadi — BE-22 ledgeridan statistika uchun (BE-28) [taklif nomlar].
 * lead-service → finance-service RPC. Pul faqat ledgerdan olinadi, shuning uchun
 * statistikadagi daromad moliya bilan mos (BE-28 qabul mezoni).
 */
export const FINANCE_AFFILIATE_RPC = {
  /** FinanceAffiliateIncomeQuery → FinanceAffiliateIncomeResult */
  INCOME: 'finance.affiliate.income',
} as const;

export interface FinanceAffiliateIncomeQuery {
  /** Sotuvchi (AFFILIATE hisobi egasi). */
  affiliateId: string;
  /**
   * Davr — Toshkent sanasi `YYYY-MM-DD`, `to` kuni ham kiradi. Yetkazish yozuvi
   * yetkazilgan kuni, qaytarish yozuvi qaytarilgan kuni bo‘yicha olinadi.
   */
  from?: string;
  to?: string;
  /**
   * Berilsa — davrsiz, faqat shu lidlarning yetkazish yozuvlari (hozirgi holati
   * bilan): lidlar ro‘yxatidagi «Haq» va «Haq holati» ustunlari uchun.
   */
  leadIds?: string[];
}

/** Bitta jurnal bo‘yicha sotuvchi qatori: sotuvchi haqi + ustamaning sotuvchi ulushi. */
export interface FinanceAffiliateIncomeLine {
  leadId: string | null;
  orderId: string;
  /** DELIVERED — yetkazilganda yozilgan asl yozuv (+); REVERSAL — qaytarishdagi ko‘zgu yozuv (−). */
  kind: 'DELIVERED' | 'REVERSAL';
  /** Yozuv kuni (Toshkent): yetkazilgan yoki qaytarilgan kun, `YYYY-MM-DD`. */
  day: string;
  /**
   * Statistikadagi ustun: asl yozuv AVAILABLE ga o‘tgan bo‘lsa (Elchi pulni o‘tkazgan) — AVAILABLE,
   * aks holda HOLD. Ko‘zgu yozuv asl yozuvning ustuniga tushadi: davr bo‘yicha yig‘indi hisob balansiga teng.
   */
  column: 'HOLD' | 'AVAILABLE';
  /** Butun so‘m: DELIVERED — musbat, REVERSAL — manfiy. */
  amount: number;
  /** Asl yozuvning hozirgi holati. */
  state: 'HOLD' | 'AVAILABLE' | 'REVERSED';
}

export interface FinanceAffiliateIncomeResult {
  lines: FinanceAffiliateIncomeLine[];
}
