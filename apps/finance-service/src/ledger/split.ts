import { MAX_MONEY, OrderStatusChangedEvent } from '@app/common';

/** Hisob turlari (TZ T4) va COD_CLEARING [taklif: mijoz naqd puli qarshi hisobi]. */
export type AccountType =
  | 'PLATFORM_SERVICE'
  | 'CALL_CENTER'
  | 'WHOLESALER'
  | 'AFFILIATE'
  | 'ELCHI'
  | 'TAX'
  | 'COD_CLEARING';

export type LineKind =
  | 'WHOLESALER_BASE'
  | 'AFFILIATE_FEE'
  | 'AFFILIATE_MARKUP'
  | 'CALL_CENTER_FEE'
  | 'PLATFORM_SERVICE'
  | 'PLATFORM_MARKUP'
  | 'HIDDEN_DELIVERY'
  | 'REFUSAL_FEE'
  | 'COD_RECEIVABLE'
  | 'ELCHI_KEPT'
  // BE-23 pul yechish: sotuvchidan −summa, soliq +1%, to‘lov chiqimi +qolgani
  | 'WITHDRAWAL'
  | 'WITHDRAWAL_TAX'
  | 'WITHDRAWAL_NET';

export interface SplitLine {
  account: AccountType;
  ownerId: string;
  lineKind: LineKind;
  itemSeq: number;
  productId: string | null;
  /** Tovar qatori soni (qaytarishda solishtirish uchun); COD qatorida null. */
  quantity: number | null;
  amount: number;
}

export class SplitError extends Error {}

/**
 * Ustama ulushi: 85% sotuvchiga, 15% platformaga (11-qaror, TZ 01:23; 2.5-1,
 * 01:111). Sozlama emas — ADM-2 da faqat ustama chegarasi bor (01:388).
 */
const MARKUP_AFFILIATE_PERCENT = 85;

function money(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_MONEY
  ) {
    throw new SplitError(
      `${field}: butun so‘m bo‘lishi kerak (${String(value)})`,
    );
  }
  return value;
}

/**
 * Yetkazilgan buyurtmaning taqsimoti (BE-22). Har tovar qatori uchun, butun
 * so'mda:
 * - WHOLESALER: bazaviy narx × soni (optovik narxi, 01:49);
 * - AFFILIATE: sotuvchi haqi (nusxa) + ustamaning 85% i (pastga yaxlitlab);
 * - CALL_CENTER: qo'ng'iroq markazi haqi (nusxa, 01:69);
 * - ELCHI: yashirilgan yetkazish (qisman/bepul rejim, 01:98-102; NRX-9);
 * - PLATFORM_SERVICE: qoldiq = tasdiqlangan narx − qolganlari (01:70) +
 *   ustamaning 15% i + 85% dan qolgan kasr (2.5-7: qoldiq platforma xizmatiga).
 * Qatorlar yig'indisi sotuv narxiga teng; qarshi yozuv COD_CLEARING −sotuv.
 * Sotuvchi har doim hodisadagi affiliateId — sotuvchi sahifasi egasi (TC0).
 */
export function splitDelivered(event: OrderStatusChangedEvent): SplitLine[] {
  if (!Array.isArray(event.items) || !event.items.length) {
    throw new SplitError('tovarlar ro‘yxati bo‘sh');
  }
  // Asosiy sayt sotuvida sotuvchi haqi platformada qoladi (2.5-6, 01:119),
  // hodisada affiliateId bo'lsa ham.
  const affiliateId =
    event.source !== 'SITE' && event.affiliateId
      ? String(event.affiliateId)
      : null;
  const orderWholesaler = event.wholesalerId
    ? String(event.wholesalerId)
    : null;
  if (!affiliateId && event.source !== 'SITE') {
    throw new SplitError(`${event.source} buyurtmasida affiliateId yo‘q`);
  }
  const lines: SplitLine[] = [];
  let quantity: number | null = null;
  const push = (
    account: AccountType,
    ownerId: string,
    lineKind: LineKind,
    itemSeq: number,
    productId: string | null,
    amount: number,
  ) => {
    if (amount !== 0) {
      lines.push({
        account,
        ownerId,
        lineKind,
        itemSeq,
        productId,
        quantity,
        amount,
      });
    }
  };
  let gross = 0;
  event.items.forEach((item, seq) => {
    const q = item.quantity;
    if (!Number.isSafeInteger(q) || q < 1) {
      throw new SplitError(`tovar soni noto‘g‘ri: ${String(q)}`);
    }
    if (!item.split)
      throw new SplitError('split (narx qatorlari nusxasi) yo‘q');
    const sale = money(item.salePrice, 'salePrice') * q;
    const approved = money(item.approvedPrice, 'approvedPrice') * q;
    const base = money(item.basePrice, 'basePrice') * q;
    const affiliateFee = money(item.split.affiliateFee, 'split.affiliateFee');
    const callCenter = money(item.split.callCenterFee, 'split.callCenterFee');
    const hidden = money(item.split.hiddenDelivery, 'split.hiddenDelivery');
    const markup = sale - approved;
    // Sotuvchi narxni faqat oshira oladi (2.5-1, 01:111).
    if (markup < 0)
      throw new SplitError('sotuv narxi tasdiqlangan narxdan past');
    const markupAffiliate = Math.floor(
      (markup * MARKUP_AFFILIATE_PERCENT) / 100,
    );
    const markupPlatform = markup - markupAffiliate;
    const platform = approved - base - affiliateFee - callCenter - hidden;
    if (platform < 0) {
      throw new SplitError(
        `narx qatorlari tasdiqlangan narxdan katta (platforma qoldig‘i ${platform})`,
      );
    }
    if (
      item.split.platformService !== undefined &&
      item.split.platformService !== platform
    ) {
      throw new SplitError(
        `platforma xizmati mos emas: hodisada ${item.split.platformService}, hisobda ${platform}`,
      );
    }
    const productId = item.productId ? String(item.productId) : null;
    const wholesalerId = item.wholesalerId
      ? String(item.wholesalerId)
      : orderWholesaler;
    if (!wholesalerId) throw new SplitError('wholesalerId yo‘q');
    quantity = q;
    push('WHOLESALER', wholesalerId, 'WHOLESALER_BASE', seq, productId, base);
    if (affiliateId) {
      push(
        'AFFILIATE',
        affiliateId,
        'AFFILIATE_FEE',
        seq,
        productId,
        affiliateFee,
      );
      push(
        'AFFILIATE',
        affiliateId,
        'AFFILIATE_MARKUP',
        seq,
        productId,
        markupAffiliate,
      );
    } else {
      // Asosiy sayt: sotuvchi haqi platformada qoladi (2.5-6, 01:119) [taklif: hisob].
      push(
        'PLATFORM_SERVICE',
        '',
        'AFFILIATE_FEE',
        seq,
        productId,
        affiliateFee,
      );
      push(
        'PLATFORM_SERVICE',
        '',
        'AFFILIATE_MARKUP',
        seq,
        productId,
        markupAffiliate,
      );
    }
    push('CALL_CENTER', '', 'CALL_CENTER_FEE', seq, productId, callCenter);
    push('ELCHI', '', 'HIDDEN_DELIVERY', seq, productId, hidden);
    push('PLATFORM_SERVICE', '', 'PLATFORM_SERVICE', seq, productId, platform);
    push(
      'PLATFORM_SERVICE',
      '',
      'PLATFORM_MARKUP',
      seq,
      productId,
      markupPlatform,
    );
    gross += sale;
  });
  if (gross > MAX_MONEY)
    throw new SplitError('buyurtma summasi chegaradan katta');
  lines.push({
    account: 'COD_CLEARING',
    ownerId: '',
    lineKind: 'COD_RECEIVABLE',
    itemSeq: 0,
    productId: null,
    quantity: null,
    amount: -gross,
  });
  return lines;
}

/** Buyurtmaning sotuv summasi (yashirilgan yetkazish ichida) va yashirilgan qismi. */
export function orderTotals(event: OrderStatusChangedEvent): {
  gross: number;
  hidden: number;
} {
  let gross = 0;
  let hidden = 0;
  for (const item of event.items) {
    gross += item.salePrice * item.quantity;
    hidden += item.split?.hiddenDelivery ?? 0;
  }
  return { gross, hidden };
}
