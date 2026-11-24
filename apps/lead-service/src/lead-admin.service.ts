import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  AdminLeadsPageDto,
  AdminLeadsQueryDto,
  CatalogOfferSnapshot,
  isLeadBigintId,
  LeadCardDto,
  LeadErrorCode,
  LeadReopenedDto,
  LeadStatus,
} from '@app/common';
import { CatalogOfferClient } from './catalog-offer.client';
import { Lead, LeadHistory } from './entities';
import { LeadCardService, maskPhone } from './lead-card.service';
import { LOCK_SPACE_LEAD } from './lead-intake.service';
import { contactDeadline } from './lead-rules';
import { tashkentDayStart as dayStart } from './lead-schedule';
import { UserNamesClient } from './user-names.client';

const ACTIVE = [LeadStatus.NEW, LeadStatus.BOOKED, LeadStatus.CALLBACK];

const DEFAULT_LIMIT = 20;

/**
 * Admin va nazoratchi uchun lidlar (BE-42; FE-26). Filtrlar FE-26 dagi bilan bir xil: holat, sotuvchi,
 * mahsulot, operator, sana (Toshkent kuni, `to` kuni ham kiradi). Telefon niqoblangan (TC2).
 * Sotuvchi va operator ismlari identity dan (BE-25); identity javob bermasa `#ID`.
 */
@Injectable()
export class LeadAdminService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    private readonly catalog: CatalogOfferClient,
    private readonly cards: LeadCardService,
    @Optional() private readonly userNames?: UserNamesClient,
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
    const resolved = this.userNames
      ? await this.userNames.resolve(
          rows.flatMap((r) => [r.affiliateId, r.operatorId]),
        )
      : (id: string) => `#${id}`;
    const nameOf = (id: string | null) => (id ? resolved(id) : null);
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

  /**
   * Admin «Rad etildi» lidni qayta ochadi (TZ 3-bo‘lim ruxsatlar jadvali: faqat admin; 5-bo‘lim 10-qoida: «3 kun
   * ichida faqat admin ochadi»; BE-35 TC4). Sabab majburiy; lid tarixiga kim, qachon va sabab (11-qoida).
   * Lid navbatga yangi lid sifatida qaytadi: urinishlar 0 dan, yangi 3 kunlik aloqa oynasi (2-qoida) [taklif].
   * Admin uchun 3 kunlik chegara yo‘q [taklif]. Shu raqam va mahsulotda faol lid bo‘lsa — 409 (LID-4: ikkita faol
   * lid ochilmaydi). Qulf — lid qabul qilish bilan bir xil (raqam + mahsulot).
   */
  async reopen(
    actorId: string,
    leadId: string,
    reason: string,
    now = new Date(),
  ): Promise<LeadReopenedDto> {
    if (!isLeadBigintId(leadId))
      throw new BadRequestException('leadId noto‘g‘ri');
    const why = String(reason ?? '').trim();
    if (!why)
      throw new BadRequestException({
        message: ['reason qayta ochish sababi majburiy'],
      });
    return this.leads.manager.transaction(async (m) => {
      const leads = m.getRepository(Lead);
      const head = await leads.findOne({
        where: { id: leadId, isDeleted: false },
      });
      if (!head) throw new NotFoundException('Lid topilmadi');
      await m.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        LOCK_SPACE_LEAD,
        `${head.phoneE164}:${head.productId}`,
      ]);
      const lead = await leads.findOne({
        where: { id: leadId, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lead || lead.status !== LeadStatus.REJECTED || lead.mergedIntoId)
        throw new ConflictException({
          message: 'Faqat «Rad etildi» holatidagi lid qayta ochiladi',
          errorCode: LeadErrorCode.LEAD_NOT_REJECTED,
        });
      const active = await leads.findOne({
        where: {
          id: Not(lead.id),
          phoneE164: lead.phoneE164,
          productId: lead.productId,
          status: In(ACTIVE),
          mergedIntoId: IsNull(),
          isDeleted: false,
        },
      });
      if (active)
        throw new ConflictException({
          message: `Shu raqam va mahsulotda faol lid bor (#${active.id})`,
          errorCode: LeadErrorCode.ACTIVE_LEAD_EXISTS,
        });
      const reject = lead.rejectReason;
      lead.status = LeadStatus.NEW;
      lead.rejectReason = null;
      lead.attempts = 0;
      lead.operatorId = null;
      lead.bookedUntil = null;
      lead.bookedFromCallback = false;
      lead.nextAttemptAt = now;
      lead.expiresAt = contactDeadline(now);
      await leads.save(lead);
      const history = m.getRepository(LeadHistory);
      await history.save(
        history.create({
          leadId: lead.id,
          fromStatus: LeadStatus.REJECTED,
          toStatus: LeadStatus.NEW,
          actorId,
          field: 'reopen',
          oldValue: { rejectReason: reject },
          newValue: { reason: why },
          note: `Admin qayta ochdi: ${why}`,
        }),
      );
      return { leadId: lead.id, status: lead.status };
    });
  }
}
