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

/** Foiz, butun son; maxraj 0 bo‘lsa — bo‘sh («statistika yo‘q»). */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 100) / whole) : null;
}

/** Sotuvchiga sahifa ochish mumkinmi (BE-11 TC5: qoldiq 0 → rad). */
export function canOpenStream(offer: CatalogOfferSnapshot | null): boolean {
  return (
    !!offer &&
    offer.cpaAvailable &&
    !offer.withdrawn &&
    offer.approvedPrice !== null &&
    offer.stock > 0
  );
}
