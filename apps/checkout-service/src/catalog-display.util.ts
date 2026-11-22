import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  CATALOG_DISPLAY_LOOKUP,
  CatalogDisplayLookupRequest,
  CatalogDisplayLookupResult,
} from '@app/common';

/**
 * Katalog javobini kutish chegarasi, ms. Bu faqat ko‘rinish ma’lumoti (nom, rasm): katalog o‘chiq bo‘lsa asosiy javob
 * gateway’ning 10 s chegarasidan (`RPC_TIMEOUT_MS`) oldin nom/rasmsiz qaytishi kerak. Qiymat katalogdagi
 * `INVENTORY_TIMEOUT_MS` bilan bir xil [taklif].
 */
export const CATALOG_DISPLAY_TIMEOUT_MS = 1500;

/** BE-29: do‘kon nomi, mahsulot va variant rasmi (`catalog.display.lookup`); xato yoki kechikishda — rad etiladi. */
export function catalogDisplayLookup(
  catalog: ClientProxy,
  request: CatalogDisplayLookupRequest,
): Promise<CatalogDisplayLookupResult> {
  return firstValueFrom(
    catalog
      .send<CatalogDisplayLookupResult>(
        { cmd: CATALOG_DISPLAY_LOOKUP },
        request,
      )
      .pipe(timeout(CATALOG_DISPLAY_TIMEOUT_MS)),
  );
}
