import { JwtUser, ProductDto, Role, WholesalerDto } from '@app/common';

/**
 * BE-25 (FE-16, OMB-1): omborchi arizasiz postavkani ochishi uchun optovik va mahsulotni tanlaydi. Admin javobidan
 * faqat tanlash va qabul aktiga kerak maydonlar: narx, sotuvchi haqi, bank rekvizitlari, telefon va kabinet egasi
 * chiqmaydi (TZ 3-bo‘lim: omborchiga narx va to‘lov ochiq emas). Yangi maydon o‘z-o‘zidan chiqib ketmaydi.
 */
export const WAREHOUSE_WHOLESALER_FIELDS = [
  'id',
  'name',
  'status',
  'tin',
  'contractNumber',
  'contractDate',
] as const satisfies ReadonlyArray<keyof WholesalerDto>;

export const WAREHOUSE_PRODUCT_FIELDS = [
  'id',
  'shopId',
  'name',
  'status',
  'cpaEnabled',
  'isBad',
  'isBlocked',
  'expiryTracked',
  'weightGrams',
] as const satisfies ReadonlyArray<keyof ProductDto>;

/** To‘liq javob faqat admin va superadminga. */
export const seesFullView = (user: JwtUser): boolean =>
  user.role === Role.ADMIN || user.role === Role.SUPERADMIN;

export function pickFields<T extends object, K extends keyof T>(
  page: { items: T[] },
  fields: readonly K[],
) {
  return {
    ...page,
    items: page.items.map(
      (item) =>
        Object.fromEntries(
          fields.map((field) => [field, item[field] ?? null]),
        ) as Pick<T, K>,
    ),
  };
}
