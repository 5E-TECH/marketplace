import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  AdminLeadCardDto,
  JwtUser,
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
  lead?: { leadId?: string | null } | null;
  customer?: Record<string, unknown> | null;
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
  return {
    ...order,
    customer: order.customer
      ? {
          ...order.customer,
          consentAt: card.consentAt ?? null,
          original: edit?.original ?? null,
          addressEditedBy: edit?.by ?? null,
        }
      : order.customer,
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
  original: Partial<
    Record<
      'region' | 'district' | 'addressLine' | 'whereDeliver',
      string | null
    >
  >;
  by: { name: string; at: string };
} | null {
  const original: Partial<Record<string, string | null>> = {};
  let by: { name: string; at: string } | null = null;
  for (const entry of history) {
    if (!entry.changes?.length) continue;
    for (const change of entry.changes)
      if (!(change.field in original)) original[change.field] = change.from;
    by = { name: entry.actor, at: new Date(entry.at).toISOString() };
  }
  return by ? { original, by } : null;
}
