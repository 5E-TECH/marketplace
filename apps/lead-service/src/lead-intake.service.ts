import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  IsNull,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import {
  CreateLeadDto,
  LandingPageState,
  LeadCreatedDto,
  LeadErrorCode,
  LeadReviewReason,
  LeadSource,
  LeadStatus,
} from '@app/common';
import { CatalogOfferClient } from './catalog-offer.client';
import { Click, Lead, LeadHistory, Stream } from './entities';
import { landingState } from './landing.service';
import {
  LeadAddressService,
  ResolvedLeadAddress,
} from './lead-address.service';
import {
  contactDeadline,
  duplicateDecision,
  duplicateWindowStart,
  ipWindowStart,
  isHoneypotFilled,
  LEAD_RULES,
  phoneOperatorAllowed,
} from './lead-rules';

/** Yashirin maydon to‘ldirilganda qaytadi: lid yozilmagan, sahifa piksel yubormaydi. */
export const HONEYPOT_LEAD_ID = '0';

/**
 * POST /leads (BE-12): sotuvchi sahifasi formasidan ariza. Javob bazaga yozilgandan keyin (LID-3).
 * Tartib: yashirin maydon → telefon → sahifa holati → manzil (BE-38) → tranzaksiyada dublikat, IP, qora ro‘yxat.
 */
@Injectable()
export class LeadIntakeService {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Stream) private readonly streams: Repository<Stream>,
    private readonly catalog: CatalogOfferClient,
    private readonly address: LeadAddressService,
    private readonly config: ConfigService,
  ) {}

  async create(input: {
    lead: CreateLeadDto;
    ip: string | null;
    userAgent: string | null;
  }): Promise<LeadCreatedDto> {
    const dto = input.lead;
    if (isHoneypotFilled(dto.website))
      return { leadId: HONEYPOT_LEAD_ID, duplicate: false };

    if (!phoneOperatorAllowed(dto.phone, this.operatorCodes()))
      throw new BadRequestException({
        message: ['phone O‘zbekiston operator kodi bilan bo‘lishi kerak'],
      });

    const stream = await this.streams.findOne({
      where: { code: dto.code, isDeleted: false },
    });
    if (!stream) throw new NotFoundException('Bunday sotuvchi sahifasi yo‘q');
    const offer = await this.catalog.get(stream.productId);
    if (!offer || landingState(stream, offer) !== LandingPageState.OPEN)
      throw new ConflictException({
        message: 'Sahifa hozir ariza qabul qilmaydi',
        errorCode: LeadErrorCode.LANDING_NOT_OPEN,
      });

    // Geo tekshiruv tranzaksiyadan oldin (RPC paytida qulf ushlanmaydi).
    const address = await this.address.resolve(dto);
    const now = new Date();
    return this.db.transaction((manager) =>
      this.write(manager, { dto, stream, address, now, ...input }),
    );
  }

  private async write(
    manager: EntityManager,
    ctx: {
      dto: CreateLeadDto;
      stream: Stream;
      address: ResolvedLeadAddress;
      now: Date;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<LeadCreatedDto> {
    const { dto, stream, address, now } = ctx;
    const leads = manager.getRepository(Lead);
    const history = manager.getRepository(LeadHistory);

    // Bir raqam + mahsulot bo‘yicha ketma-ket: ikki marta bosilgan forma ikkita yangi lid ochmaydi.
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `lead:${dto.phone}:${stream.productId}`,
    ]);

    const click = dto.clickId
      ? await manager
          .getRepository(Click)
          .findOne({ where: { id: dto.clickId, streamId: stream.id } })
      : null;

    const previous = await leads.findOne({
      where: {
        phoneE164: dto.phone,
        productId: stream.productId,
        mergedIntoId: IsNull(),
        isDeleted: false,
        createdAt: MoreThanOrEqual(duplicateWindowStart(now)),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const decision = duplicateDecision(
      previous && {
        id: previous.id,
        status: previous.status,
        rejectedAt:
          previous.status === LeadStatus.REJECTED
            ? await this.rejectedAt(manager, previous)
            : null,
      },
      now,
    );

    const heldForReview =
      !!ctx.ip &&
      (await leads.count({
        where: { ip: ctx.ip, createdAt: MoreThanOrEqual(ipWindowStart(now)) },
      })) >= LEAD_RULES.ipMaxLeads;

    const submission = leads.create({
      source: LeadSource.LANDING,
      streamId: stream.id,
      clickId: click?.id ?? null,
      affiliateId: stream.affiliateId,
      productId: stream.productId,
      name: dto.name,
      phoneE164: dto.phone,
      regionSoato: address.regionSoato,
      districtSoato: address.districtSoato,
      addressLine: dto.addressLine,
      whereDeliver: dto.whereDeliver,
      variant: dto.variant ?? click?.variant ?? null,
      quantity: 1,
      salePrice: stream.salePrice,
      sub1: dto.sub1 ?? click?.sub1 ?? null,
      sub2: dto.sub2 ?? click?.sub2 ?? null,
      sub3: dto.sub3 ?? click?.sub3 ?? null,
      sub4: dto.sub4 ?? click?.sub4 ?? null,
      sub5: dto.sub5 ?? click?.sub5 ?? null,
      utmSource: dto.utmSource ?? click?.utmSource ?? null,
      utmMedium: dto.utmMedium ?? click?.utmMedium ?? null,
      utmCampaign: dto.utmCampaign ?? click?.utmCampaign ?? null,
      utmContent: dto.utmContent ?? click?.utmContent ?? null,
      utmTerm: dto.utmTerm ?? click?.utmTerm ?? null,
      fbclid: dto.fbclid ?? click?.fbclid ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      consentVersion: dto.consentVersion,
      consentAt: now,
      reviewReason: heldForReview ? LeadReviewReason.IP_RATE : null,
    });

    let resultLead: Lead;
    let target: Lead;
    if (decision.kind === 'NEW') {
      submission.status = LeadStatus.NEW;
      submission.nextAttemptAt = now;
      submission.expiresAt = contactDeadline(now);
      resultLead = await leads.save(submission);
      await history.save(
        history.create({
          leadId: resultLead.id,
          fromStatus: null,
          toStatus: LeadStatus.NEW,
          note: heldForReview
            ? 'Sotuvchi sahifasidan ariza — tekshiruvga: bir IP dan ko‘p ariza'
            : 'Sotuvchi sahifasidan ariza',
        }),
      );
      target = resultLead;
    } else {
      const root = await leads.findOneOrFail({
        where: { id: decision.rootId },
      });
      submission.status = LeadStatus.MERGED;
      submission.mergedIntoId = root.id;
      const merged = await leads.save(submission);
      await history.save([
        history.create({
          leadId: merged.id,
          fromStatus: null,
          toStatus: LeadStatus.MERGED,
          note: `Dublikat: ${root.id} lidiga qo‘shildi (9-qoida)`,
        }),
        history.create({
          leadId: root.id,
          fromStatus: root.status,
          toStatus: root.status,
          field: 'duplicate',
          newValue: { leadId: merged.id, streamId: stream.id },
          note: 'Shu raqam va mahsulotdan yana ariza (9-qoida)',
        }),
      ]);
      if (decision.kind === 'REOPEN_AND_MERGE') {
        const from = root.status;
        root.status = LeadStatus.NEW;
        root.attempts = 0;
        root.nextAttemptAt = now;
        root.expiresAt = contactDeadline(now);
        root.operatorId = null;
        root.bookedUntil = null;
        await leads.save(root);
        await history.save(
          history.create({
            leadId: root.id,
            fromStatus: from,
            toStatus: LeadStatus.NEW,
            note: 'Qayta ochildi: mijoz yana ariza qoldirdi (10-qoida)',
          }),
        );
      }
      resultLead = merged;
      target = root;
    }

    await this.markBlacklisted(manager, dto.phone, target);
    return { leadId: resultLead.id, duplicate: decision.kind !== 'NEW' };
  }

  /** Qora ro‘yxat (7-bo‘lim: 2 marta rad). Ishga tushishdagi chora EQ-04 javobida; hozircha belgi lid tarixida. */
  private async markBlacklisted(
    manager: EntityManager,
    phone: string,
    target: Lead,
  ): Promise<void> {
    const rejections = await manager.getRepository(Lead).count({
      where: {
        phoneE164: phone,
        status: LeadStatus.REJECTED,
        mergedIntoId: IsNull(),
        isDeleted: false,
      },
    });
    if (rejections < LEAD_RULES.blacklistRejections) return;
    const history = manager.getRepository(LeadHistory);
    await history.save(
      history.create({
        leadId: target.id,
        fromStatus: target.status,
        toStatus: target.status,
        field: 'blacklist',
        newValue: { rejections },
        note: `Qora ro‘yxat: bu raqam ${rejections} marta rad etgan (7-bo‘lim). Ishga tushishdagi chora — EQ-04`,
      }),
    );
  }

  private async rejectedAt(manager: EntityManager, lead: Lead): Promise<Date> {
    const row = await manager.getRepository(LeadHistory).findOne({
      where: { leadId: lead.id, toStatus: LeadStatus.REJECTED },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return row?.createdAt ?? lead.updatedAt;
  }

  private operatorCodes(): string[] {
    return (this.config.get<string>('LEAD_PHONE_OPERATOR_CODES') ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => /^\d{2}$/.test(c));
  }
}
