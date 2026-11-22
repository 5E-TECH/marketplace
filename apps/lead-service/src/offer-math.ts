import { CatalogOfferSnapshot } from '@app/common';

/**
 * Sahifadagi eng katta narx. Chegarani katalog beradi (NRX-4: kategoriya bo‘yicha sozlanadi, bozor narxidan oshmaydi — BE-09);
 * lead-service o‘zi foiz hisoblamaydi. Katalog bermasa — faqat tasdiqlangan narx.
 */
export function maxSalePrice(offer: CatalogOfferSnapshot): number | null {
  if (offer.approvedPrice === null) return null;
  return Math.max(
    offer.maxSalePrice ?? offer.approvedPrice,
    offer.approvedPrice,
  );
}

/**
 * Sahifadagi amaldagi narx: sotuvchi tanlagan narx katalogning joriy chegaralari ichida
 * (tasdiqlangan narxdan past emas — «kamaytira olmaydi», TZ 2.5-1; `maxSalePrice` dan yuqori emas — NRX-4).
 * Narx BE-09 da o‘zgarsa sahifa shu chegaraga keladi [taklif: ustama ko‘chishi yoki saqlanishi — ega hal qiladi].
 * Narx tasdiqlanmagan bo‘lsa — saqlangan narx (sahifa baribir NOT_ACCEPTED).
 */
export function effectiveSalePrice(
  storedPrice: number,
  offer: CatalogOfferSnapshot | null,
): number {
  const max = offer ? maxSalePrice(offer) : null;
  if (!offer || offer.approvedPrice === null || max === null)
    return storedPrice;
  return Math.min(Math.max(storedPrice, offer.approvedPrice), max);
}

/** Foiz, butun son; maxraj 0 bo‘lsa — bo‘sh («statistika yo‘q»). */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 100) / whole) : null;
}

/** BE-27 (SOT-9): offerda kamida bitta video kreativ bormi (BE-08). */
export function hasVideo(
  offer: Pick<CatalogOfferSnapshot, 'creatives'>,
): boolean {
  return (offer.creatives ?? []).some((c) => c.type === 'VIDEO');
}

/**
 * Offer sotuvchiga ko‘rinadimi (ro‘yxat va offer kartasi): CPA ochiq, olib tashlanmagan, narx tasdiqlangan va
 * kamida bitta video bor (BE-27, SOT-9). Mavjud sahifa lid qabul qilishiga video ta’sir qilmaydi (`landingState`)
 * [taklif]: admin videoni almashtirayotganda pullik lidlar yo‘qolmasin.
 */
export function isOfferVisible(
  offer: CatalogOfferSnapshot | null,
): offer is CatalogOfferSnapshot {
  return (
    !!offer &&
    offer.cpaAvailable &&
    !offer.withdrawn &&
    offer.approvedPrice !== null &&
    hasVideo(offer)
  );
}

/** Sotuvchiga sahifa ochish mumkinmi (BE-11 TC5: qoldiq 0 → rad; BE-27: videosiz — rad). */
export function canOpenStream(offer: CatalogOfferSnapshot | null): boolean {
  return (
    isOfferVisible(offer) && (offer!.stock ?? 0) > 0 // noma’lum qoldiq — yangi sahifa ochilmaydi
  );
}
