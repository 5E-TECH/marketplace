import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  CatalogOfferSnapshot,
  CheckoutDeliveryDestination,
  LEAD_CATALOG_RPC,
  LeadAddressDto,
  LeadAddressResolution,
  LeadCardDto,
  LeadPriceDto,
  LeadStatus,
  OperatorLeadListItemDto,
  RmqClient,
  sendRpc,
} from '@app/common';
import { CatalogOfferClient } from './catalog-offer.client';
import { Lead, LeadAttempt, LeadHistory, OfferContent } from './entities';
import { LEAD_RULES } from './lead-rules';
import { reminderHorizon } from './lead-schedule';

const ADDRESS_FIELDS = [
  'region_soato',
  'district_soato',
  'address_line',
  'where_deliver',
];
const PREVIOUS_LIMIT = 10;
const actorName = (id: string | null) => (id ? `#${id}` : 'Tizim');

/** Operatorga ko‘rinadigan raqam: «+998 90 *** ** 67» (EQ-02 javobiga qadar niqoblangan). */
export const maskPhone = (p: string) =>
  `+998 ${p.slice(4, 6)} *** ** ${p.slice(-2)}`;

/**
 * Lid kartasi (OPR-2, BE-13; mijoz tarixi BE-42): mahsulot, narx obyekti, suhbat skripti, manzil «formadan»,
 * urinishlar, tarix va shu raqamdagi oldingi lidlar. Variant chiqmaydi (LID-8).
 * Ismlar identity bilan (BE-05 dan keyin); hozircha `#ID`.
 */
@Injectable()
export class LeadCardService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(LeadAttempt)
    private readonly attempts: Repository<LeadAttempt>,
    @InjectRepository(LeadHistory)
    private readonly history: Repository<LeadHistory>,
    @InjectRepository(OfferContent)
    private readonly contents: Repository<OfferContent>,
    private readonly catalog: CatalogOfferClient,
    @Inject(RmqClient.CATALOG) private readonly catalogClient: ClientProxy,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
  ) {}

  /** Operator faqat o‘zidagi (bron yoki rejalashtirilgan) lidni ko‘radi; aks holda 404. */
  async forOperator(operatorId: string, leadId: string): Promise<LeadCardDto> {
    const lead = await this.leads.findOne({
      where: { id: leadId, isDeleted: false },
    });
    if (
      !lead ||
      lead.operatorId !== operatorId ||
      ![LeadStatus.BOOKED, LeadStatus.CALLBACK].includes(lead.status)
    )
      throw new NotFoundException('Lid topilmadi yoki bu operatorda emas');
    return this.build(lead);
  }

  /** «Mening bronlarim va rejalashtirilgan qo‘ng‘iroqlar» (OPR-1). */
  async listMine(operatorId: string): Promise<OperatorLeadListItemDto[]> {
    const rows = await this.leads.find({
      where: {
        operatorId,
        status: In([LeadStatus.BOOKED, LeadStatus.CALLBACK]),
        isDeleted: false,
      },
      order: { status: 'ASC', nextAttemptAt: 'ASC', id: 'ASC' },
    });
    const offers = rows.length
      ? await this.catalog
          .list({ productIds: [...new Set(rows.map((r) => r.productId))] })
          .catch(() => [] as CatalogOfferSnapshot[])
      : [];
    const names = new Map(offers.map((o) => [o.productId, o.name]));
    const horizon = reminderHorizon(new Date());
    return rows.map((r) => {
      const callbackAt =
        r.status === LeadStatus.CALLBACK || r.bookedFromCallback
          ? r.nextAttemptAt
          : null;
      return {
        id: r.id,
        status: r.status,
        customerName: r.name,
        productName: names.get(r.productId) ?? '',
        bookedUntil: r.bookedUntil?.toISOString() ?? null,
        callbackAt: callbackAt?.toISOString() ?? null,
        reminderDue: !!callbackAt && callbackAt.getTime() <= horizon.getTime(),
      };
    });
  }

  async build(lead: Lead): Promise<LeadCardDto> {
    const [offer, content, attempts, history, previous, address, rejections] =
      await Promise.all([
        this.catalog.get(lead.productId).catch(() => null),
        this.contents.findOne({
          where: { productId: lead.productId, isDeleted: false },
        }),
        this.attempts.find({
          where: { leadId: lead.id },
          order: { createdAt: 'ASC', id: 'ASC' },
        }),
        this.history.find({
          where: { leadId: lead.id },
          order: { createdAt: 'ASC', id: 'ASC' },
        }),
        this.previousLeads(lead),
        this.address(lead),
        this.leads.count({
          where: {
            phoneE164: lead.phoneE164,
            status: LeadStatus.REJECTED,
            mergedIntoId: IsNull(),
            isDeleted: false,
          },
        }),
      ]);
    return {
      id: lead.id,
      status: lead.status,
      source: lead.source,
      customerName: lead.name,
      phoneMasked: maskPhone(lead.phoneE164),
      product: {
        id: lead.productId,
        name: offer?.name ?? '',
        salePrice: Number(lead.salePrice),
      },
      quantity: lead.quantity,
      address,
      price: lead.whereDeliver
        ? await this.price(lead, offer, lead.quantity, lead.whereDeliver)
        : null,
      rejectReason: lead.rejectReason,
      callScript: content?.callScript ?? null,
      stockShortage: !!lead.stockShortageAt,
      blacklistRejections:
        rejections >= LEAD_RULES.blacklistRejections ? rejections : null,
      attemptsCount: lead.attempts,
      bookedUntil: lead.bookedUntil?.toISOString() ?? null,
      nextAttemptAt: lead.nextAttemptAt?.toISOString() ?? null,
      orderId: lead.orderId,
      attempts: attempts.map((a) => ({
        at: a.createdAt,
        operatorName: actorName(a.operatorId),
        outcome: a.outcome,
        comment: a.comment,
      })),
      history: history.map((h) => ({
        at: h.createdAt,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        actor: actorName(h.actorId),
        note: h.note,
      })),
      previousLeads: previous,
      createdAt: lead.createdAt,
    };
  }

  /** Narx obyekti (FE-09): yetkazish og‘irlikka qarab katalogdan (BE-09); bitta dona — sahifadagi ko‘rinadigan yetkazish. */
  async price(
    lead: Pick<Lead, 'productId' | 'salePrice'>,
    offer: CatalogOfferSnapshot | null,
    quantity: number,
    whereDeliver: CheckoutDeliveryDestination,
  ): Promise<LeadPriceDto | null> {
    const unitPrice = Number(lead.salePrice);
    let deliveryFee: number | null = null;
    try {
      const quote = await sendRpc<{ deliveryFee: number }>(
        this.catalogClient,
        { cmd: LEAD_CATALOG_RPC.OFFER_QUOTE },
        { productId: lead.productId, quantity, whereDeliver },
      );
      deliveryFee = quote.deliveryFee;
    } catch {
      if (offer && quantity === 1)
        deliveryFee =
          whereDeliver === CheckoutDeliveryDestination.CENTER
            ? offer.centerDeliveryFee
            : offer.addressDeliveryFee;
    }
    if (deliveryFee === null) return null;
    const subtotal = unitPrice * quantity;
    return {
      unitPrice,
      quantity,
      subtotal,
      whereDeliver,
      deliveryFee,
      totalAmount: subtotal + deliveryFee,
    };
  }

  /** POST /operator/leads/:id/quote: miqdor yoki yetkazish turi o‘zgarganda (FE-09 TC2, TC3). Bo‘sh — hisoblab bo‘lmadi. */
  async priceFor(
    productId: string,
    salePrice: number,
    quantity: number,
    whereDeliver: CheckoutDeliveryDestination,
  ): Promise<LeadPriceDto | null> {
    const offer = await this.catalog.get(productId).catch(() => null);
    return this.price(
      { productId, salePrice: String(salePrice) },
      offer,
      quantity,
      whereDeliver,
    );
  }

  private async address(lead: Lead): Promise<LeadAddressDto | null> {
    if (
      !lead.regionSoato ||
      !lead.districtSoato ||
      !lead.addressLine ||
      !lead.whereDeliver
    )
      return null;
    let names = {
      regionName: lead.regionSoato,
      districtName: lead.districtSoato,
    };
    try {
      const r = await sendRpc<LeadAddressResolution>(
        this.integration,
        { cmd: 'integration.geo.resolve-address' },
        { regionSoato: lead.regionSoato, districtSoato: lead.districtSoato },
      );
      if (r.ok)
        names = { regionName: r.regionName, districtName: r.districtName };
    } catch {
      // Geo kesh ishlamasa ham karta ochiladi: nom o‘rnida SOATO kodi.
    }
    const edits = await this.history.count({
      where: {
        leadId: lead.id,
        field: In(ADDRESS_FIELDS),
        actorId: Not(IsNull()),
      },
    });
    return {
      regionSoato: lead.regionSoato,
      districtSoato: lead.districtSoato,
      addressLine: lead.addressLine,
      whereDeliver: lead.whereDeliver,
      confirmedAt: lead.addressConfirmedAt?.toISOString() ?? null,
      editedByOperator: edits > 0,
      ...names,
    };
  }

  private async previousLeads(
    lead: Lead,
  ): Promise<LeadCardDto['previousLeads']> {
    const rows = await this.leads.find({
      where: {
        phoneE164: lead.phoneE164,
        id: Not(lead.id),
        mergedIntoId: IsNull(),
        isDeleted: false,
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: PREVIOUS_LIMIT,
    });
    if (!rows.length) return [];
    const offers = await this.catalog
      .list({ productIds: [...new Set(rows.map((r) => r.productId))] })
      .catch(() => [] as CatalogOfferSnapshot[]);
    const names = new Map(offers.map((o) => [o.productId, o.name]));
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      productName: names.get(r.productId) ?? '',
      status: r.status,
      orderId: r.orderId,
      orderStatus: null,
      rejectReason: r.rejectReason,
    }));
  }
}
