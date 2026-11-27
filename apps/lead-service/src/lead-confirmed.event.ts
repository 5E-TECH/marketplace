import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import {
  LEAD_EVENTS,
  LeadConfirmedEvent,
  LeadConfirmedVia,
  OutboxEvent,
} from '@app/common';
import { Lead, LeadItem } from './entities';

/**
 * `lead.confirmed` outbox’ga (BE-13 → BE-18). Operator tasdig‘i va BE-34 dagi SMS tasdig‘i uchun bitta qoida.
 * Saytdan ko‘p tovarli lidda `items` — hamma qator; operator sonni o‘zgartirgan bo‘lsa (faqat lidning o‘z soni),
 * birinchi qator shunga moslanadi. BE-45: operator qo‘shgan qo‘shimcha tovar (har qanday manba) — `upsell` belgisi bilan.
 */
export async function enqueueLeadConfirmed(
  manager: EntityManager,
  lead: Lead,
  opts: { confirmedBy: string | null; via: LeadConfirmedVia; now: Date },
): Promise<void> {
  const repo = manager.getRepository(LeadItem);
  const items = await repo.find({
    where: { leadId: lead.id },
    order: { position: 'ASC', id: 'ASC' },
  });
  if (items.length && items[0].quantity !== lead.quantity) {
    items[0].quantity = lead.quantity;
    await repo.save(items[0]);
  }
  const payload: LeadConfirmedEvent = {
    eventId: randomUUID(),
    leadId: lead.id,
    source: lead.source,
    streamId: lead.streamId,
    affiliateId: lead.affiliateId,
    productId: lead.productId,
    quantity: lead.quantity,
    salePrice: Number(lead.salePrice),
    customerName: lead.name,
    customerPhone: lead.phoneE164,
    regionSoato: lead.regionSoato!,
    districtSoato: lead.districtSoato!,
    addressLine: lead.addressLine!,
    whereDeliver: lead.whereDeliver!,
    confirmedBy: opts.confirmedBy,
    confirmedVia: opts.via,
    addressConfirmedBy: lead.addressConfirmedBy,
    confirmedAt: opts.now.toISOString(),
    ...(items.length
      ? {
          items: items.map((item) => ({
            productId: String(item.productId),
            quantity: item.quantity,
            salePrice: Number(item.salePrice),
            // BE-45: operator qo‘shgan qo‘shimcha tovar
            ...(item.isUpsell ? { upsell: true } : {}),
          })),
        }
      : {}),
  };
  const outbox = manager.getRepository(OutboxEvent);
  await outbox.save(
    outbox.create({
      aggregateType: 'lead',
      aggregateId: lead.id,
      eventType: LEAD_EVENTS.CONFIRMED,
      payload,
    }),
  );
}
