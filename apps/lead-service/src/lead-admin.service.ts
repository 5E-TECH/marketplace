import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AdminLeadsPageDto,
  AdminLeadsQueryDto,
  CatalogOfferSnapshot,
  LeadCardDto,
} from '@app/common';
import { CatalogOfferClient } from './catalog-offer.client';
import { Lead } from './entities';
import { LeadCardService, maskPhone } from './lead-card.service';
import { tashkentDayStart as dayStart } from './lead-schedule';

const DEFAULT_LIMIT = 20;
const nameOf = (id: string | null) => (id ? `#${id}` : null);

/**
 * Admin va nazoratchi uchun lidlar (BE-42; FE-26). Filtrlar FE-26 dagi bilan bir xil: holat, sotuvchi,
 * mahsulot, operator, sana (Toshkent kuni, `to` kuni ham kiradi). Telefon niqoblangan (TC2).
 * Sotuvchi va operator ismlari identity bilan (BE-05 dan keyin); hozircha `#ID`.
 */
@Injectable()
export class LeadAdminService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    private readonly catalog: CatalogOfferClient,
    private readonly cards: LeadCardService,
  ) {}

  async list(query: AdminLeadsQueryDto): Promise<AdminLeadsPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const qb = this.leads.createQueryBuilder('l').where('l.is_deleted = false');
    if (query.status)
      qb.andWhere('l.status = :status', { status: query.status });
    if (query.affiliateId)
      qb.andWhere('l.affiliate_id = :affiliateId', {
        affiliateId: query.affiliateId,
      });
    if (query.productId)
      qb.andWhere('l.product_id = :productId', { productId: query.productId });
    if (query.operatorId)
      qb.andWhere('l.operator_id = :operatorId', {
        operatorId: query.operatorId,
      });
    if (query.from)
      qb.andWhere('l.created_at >= :from', { from: dayStart(query.from) });
    if (query.to)
      qb.andWhere('l.created_at < :to', { to: dayStart(query.to, 1) });
    const [rows, total] = await qb
      .orderBy('l.created_at', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const offers = rows.length
      ? await this.catalog
          .list({ productIds: [...new Set(rows.map((r) => r.productId))] })
          .catch(() => [] as CatalogOfferSnapshot[])
      : [];
    const names = new Map(offers.map((o) => [o.productId, o.name]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        status: r.status,
        source: r.source,
        customerName: r.name,
        phoneMasked: maskPhone(r.phoneE164),
        productName: names.get(r.productId) ?? '',
        affiliateName: nameOf(r.affiliateId),
        operatorName: nameOf(r.operatorId),
        orderId: r.orderId,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Lid kartasi admin va nazoratchi uchun: operator egaligi tekshirilmaydi (rol gateway'da). */
  async card(leadId: string): Promise<LeadCardDto> {
    const lead = await this.leads.findOne({
      where: { id: leadId, isDeleted: false },
    });
    if (!lead) throw new NotFoundException('Lid topilmadi');
    return this.cards.build(lead);
  }
}
