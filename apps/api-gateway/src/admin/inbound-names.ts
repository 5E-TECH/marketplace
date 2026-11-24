import { Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  CATALOG_DISPLAY_LOOKUP,
  CatalogDisplayLookupResult,
  IDENTITY_USER_NAMES,
  InboundShipmentDto,
  StockLotDto,
  UserNameRow,
} from '@app/common';

/**
 * Nomlar — ko‘rinish ma’lumoti: katalog yoki identity javob bermasa ham ro‘yxat (nomsiz) qaytsin. Qiymat
 * checkout’dagi `CATALOG_DISPLAY_TIMEOUT_MS` bilan bir xil [taklif].
 */
export const NAMES_TIMEOUT_MS = 1_500;

const logger = new Logger('InboundNames');

async function lookup<T>(
  client: ClientProxy,
  cmd: string,
  data: unknown,
): Promise<T | null> {
  try {
    return await firstValueFrom(
      client.send<T>({ cmd }, data).pipe(timeout(NAMES_TIMEOUT_MS)),
    );
  } catch (error) {
    logger.warn(`${cmd}: nomlar olinmadi — ${(error as Error)?.message}`);
    return null;
  }
}

const unique = (ids: Array<string | null | undefined>): string[] => [
  ...new Set(ids.filter((id): id is string => !!id).map(String)),
];

/**
 * BE-25 (FE-16): postavkalarga optovik nomi, kim kiritgani va kim qabul qilgani, qatorlarga «muddat kuzatiladi» (OMB-3).
 * Faqat xodimlar panelida — optovik kabineti xodim ismlarini ko‘rmaydi.
 */
export async function withShipmentNames(
  clients: { catalog: ClientProxy; identity: ClientProxy },
  shipments: InboundShipmentDto[],
): Promise<InboundShipmentDto[]> {
  if (!shipments.length) return shipments;
  const [display, users] = await Promise.all([
    lookup<CatalogDisplayLookupResult>(
      clients.catalog,
      CATALOG_DISPLAY_LOOKUP,
      {
        shopIds: unique(shipments.map((s) => s.wholesalerId)),
        productIds: unique(
          shipments.flatMap((s) => s.items.map((item) => item.productId)),
        ),
      },
    ),
    lookup<UserNameRow[]>(clients.identity, IDENTITY_USER_NAMES, {
      ids: unique(shipments.flatMap((s) => [s.declaredBy, s.receivedBy])),
    }),
  ]);
  const shops = new Map(display?.shops.map((s) => [String(s.id), s.name]));
  const tracked = new Map(
    display?.products.map((p) => [String(p.id), p.expiryTracked]),
  );
  const people = new Map(users?.map((u) => [String(u.id), u]));
  return shipments.map((shipment) => {
    const declared = people.get(String(shipment.declaredBy));
    return {
      ...shipment,
      wholesalerName: shops.get(String(shipment.wholesalerId)) ?? null,
      declaredByName: declared?.name ?? null,
      declaredByRole: declared?.role ?? null,
      receivedByName: shipment.receivedBy
        ? (people.get(String(shipment.receivedBy))?.name ?? null)
        : null,
      items: shipment.items.map((item) => ({
        ...item,
        expiryTracked: tracked.get(String(item.productId)) ?? null,
      })),
    };
  });
}

/** BE-25 (FE-16): partiyalarga optovik nomi. */
export async function withLotNames(
  catalog: ClientProxy,
  lots: StockLotDto[],
): Promise<StockLotDto[]> {
  if (!lots.length) return lots;
  const display = await lookup<CatalogDisplayLookupResult>(
    catalog,
    CATALOG_DISPLAY_LOOKUP,
    { shopIds: unique(lots.map((lot) => lot.wholesalerId)) },
  );
  const shops = new Map(display?.shops.map((s) => [String(s.id), s.name]));
  return lots.map((lot) => ({
    ...lot,
    wholesalerName: shops.get(String(lot.wholesalerId)) ?? null,
  }));
}
