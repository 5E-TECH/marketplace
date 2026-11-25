import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  AdminLeadCardDto,
  JwtUser,
  LeadHistoryChangeDto,
  LeadHistoryEntryDto,
  OrderViewer,
  Role,
} from '@app/common';

/** Lid ma’lumotini kutish: lead-service javob bermasa buyurtma kartasi baribir ochiladi [taklif]. */
const LEAD_TIMEOUT_MS = 1_500;

/** Buyurtmani kim ko‘ryapti: admin va superadmin, nazoratchi, qolgani — operator (faqat o‘ziniki). */
export function orderViewer(user: JwtUser): OrderViewer {
  const kind =
    user.role === Role.ADMIN || user.role === Role.SUPERADMIN
      ? 'ADMIN'
      : user.role === Role.SUPERVISOR
        ? 'SUPERVISOR'
        : 'OPERATOR';
  return { kind, userId: String(user.sub) };
}

/** Checkout javobining shu yerda ishlatiladigan qismi. */
export interface OrderDetailRpc {
  lead?: { leadId?: string | null; whereDeliver?: string | null } | null;
  customer?: {
    regionName?: string | null;
    districtName?: string | null;
    addressLine?: string | null;
    addressConfirmedBy?: { name: string; at: string | null } | null;
    [key: string]: unknown;
  } | null;
  stream?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/**
 * BE-25 (FE-26): buyurtma kartasiga lid ma’lumoti — sub, rozilik, lid kelgan vaqt, mijoz sahifada yozgan manzil (operator
 * tuzatgan bo‘lsa), tuzatgan odam va postback jurnali. Nazoratchiga sub ko‘rinmaydi (lid kartasidagi kabi).
 */
export async function withLeadContext(
  leadClient: ClientProxy,
  order: OrderDetailRpc,
  user: JwtUser,
): Promise<OrderDetailRpc> {
  const leadId = order?.lead?.leadId;
  if (!leadId) return order;
  const viewer = orderViewer(user);
  let card: AdminLeadCardDto;
  try {
    card = await firstValueFrom(
      leadClient
        .send<AdminLeadCardDto>(
          { cmd: 'lead.admin.card' },
          { leadId, viewer: { admin: viewer.kind === 'ADMIN' } },
        )
        .pipe(timeout(LEAD_TIMEOUT_MS)),
    );
  } catch {
    return order;
  }
  const edit = addressEdit(card.history ?? []);
  const customer = order.customer;
  // tuzatilgan maydon — mijoz yozgani (yozmagan bo‘lsa null), tuzatilmagani — hozirgidek
  const originalOf = (
    field: LeadHistoryChangeDto['field'],
    current: string | null | undefined,
  ): string | null =>
    edit && field in edit.original
      ? (edit.original[field] ?? null)
      : (current ?? null);
  return {
    ...order,
    customer: customer
      ? {
          ...customer,
          consentAt: card.consentAt ?? null,
          // mijoz sahifada yozgani — faqat operator tuzatgan bo‘lsa (tuzatilmagan maydonlar hozirgidek)
          original: edit
            ? {
                regionName: originalOf('region', customer.regionName),
                districtName: originalOf('district', customer.districtName),
                addressLine: originalOf('addressLine', customer.addressLine),
                whereDeliver: originalOf(
                  'whereDeliver',
                  order.lead?.whereDeliver,
                ),
              }
            : null,
          addressEditedBy: edit?.by ?? null,
          addressConfirmedBy: customer.addressConfirmedBy
            ? {
                ...customer.addressConfirmedBy,
                at: card.address?.confirmedAt ?? null,
              }
            : null,
        }
      : customer,
    stream:
      order.stream && viewer.kind !== 'OPERATOR'
        ? {
            ...order.stream,
            sub1: card.stream?.sub1 ?? null,
            leadCreatedAt: new Date(card.createdAt).toISOString(),
          }
        : (order.stream ?? null),
    postbacks: viewer.kind === 'ADMIN' ? (card.postbacks ?? []) : [],
  };
}

/** Manzil tuzatishlari: har maydonning eng birinchi (mijoz yozgan) qiymati va oxirgi tuzatgan odam. */
export function addressEdit(history: LeadHistoryEntryDto[]): {
  original: Partial<Record<LeadHistoryChangeDto['field'], string | null>>;
  by: { name: string; at: string };
} | null {
  const original: Partial<
    Record<LeadHistoryChangeDto['field'], string | null>
  > = {};
  let by: { name: string; at: string } | null = null;
  for (const entry of history) {
    if (!entry.changes?.length) continue;
    for (const change of entry.changes)
      if (!(change.field in original)) original[change.field] = change.from;
    by = { name: entry.actor, at: new Date(entry.at).toISOString() };
  }
  return by ? { original, by } : null;
}
