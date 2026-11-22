import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { In, IsNull, QueryFailedError, Repository } from 'typeorm';
import {
  AffiliateStreamDto,
  AffiliateStreamsPageDto,
  AffiliateStreamStatus,
  assertSafeUrlResolved,
  CatalogOfferSnapshot,
  encryptSecret,
  StreamTemplate,
  UpdateAffiliateStreamDto,
} from '@app/common';
import { CatalogOfferClient } from './catalog-offer.client';
import { Click, Lead, Stream } from './entities';
import {
  canOpenStream,
  effectiveSalePrice,
  hasVideo,
  maxSalePrice,
} from './offer-math';

const CODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 5;

/** Postgres unique_violation. */
const isUniqueViolation = (err: unknown) =>
  err instanceof QueryFailedError &&
  (err as QueryFailedError & { code?: string }).code === '23505';

/**
 * Sotuvchi sahifasi (oqim, BE-11): bir tugma bilan yaratish, sozlamalar, ro‘yxat.
 * Sahifa yaratilganda sotuvchiga bog‘lanadi va bu bog‘lanish o‘zgarmaydi (SOT-3).
 */
@Injectable()
export class StreamService {
  constructor(
    @InjectRepository(Stream) private readonly streams: Repository<Stream>,
    @InjectRepository(Click) private readonly clicks: Repository<Click>,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    private readonly catalog: CatalogOfferClient,
    private readonly config: ConfigService,
  ) {}

  /** «Sahifa yaratish» — faqat offer ID: standart shablon, tasdiqlangan narx, unikal kod (TC1–TC3, TC5). */
  async create(
    affiliateId: string,
    productId: string,
  ): Promise<AffiliateStreamDto> {
    const offer = await this.catalog.get(productId);
    if (!offer) throw new NotFoundException('Offer topilmadi');
    if (!canOpenStream(offer))
      throw new ConflictException(
        !offer.cpaAvailable || offer.withdrawn || offer.approvedPrice === null
          ? 'Offer sotuvchilarga ochiq emas'
          : !hasVideo(offer)
            ? 'Offerda video yo‘q: sahifa ochilmaydi'
            : 'Qoldiq yo‘q: bu offerga sahifa ochilmaydi',
      );
    for (let attempt = 1; ; attempt++) {
      try {
        const stream = await this.streams.save(
          this.streams.create({
            code: this.newCode(),
            affiliateId,
            productId,
            salePrice: String(offer.approvedPrice),
            status: AffiliateStreamStatus.ACTIVE,
            template: StreamTemplate.STANDART,
          }),
        );
        return this.toDto(stream, offer, { clicks: 0, leads: 0 });
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= CODE_ATTEMPTS) throw err;
      }
    }
  }

  /** Sozlamalar: shablon, narx (tasdiqlangandan +10% gacha), sub, piksel, postback (TC4, TC6). */
  async update(
    affiliateId: string,
    streamId: string,
    patch: UpdateAffiliateStreamDto,
  ): Promise<AffiliateStreamDto> {
    const stream = await this.streams.findOne({
      where: { id: streamId, affiliateId, isDeleted: false },
    });
    if (!stream) throw new NotFoundException('Sahifa bu sotuvchiniki emas');
    const offer = await this.catalog.get(stream.productId);

    if (patch.salePrice !== undefined) {
      const max = offer ? maxSalePrice(offer) : null;
      if (!offer || offer.approvedPrice === null || max === null)
        throw new ConflictException('Offer narxi tasdiqlanmagan');
      if (patch.salePrice < offer.approvedPrice || patch.salePrice > max)
        throw new BadRequestException({
          message: [
            `salePrice ${offer.approvedPrice} dan ${max} gacha bo‘lishi kerak`,
          ],
        });
      stream.salePrice = String(patch.salePrice);
    }
    if (patch.template != null) stream.template = patch.template;
    for (const key of ['sub1', 'sub2', 'sub3', 'sub4', 'sub5'] as const)
      if (patch[key] !== undefined) stream[key] = patch[key] || null;
    if (patch.metaPixelId !== undefined)
      stream.metaPixelId = patch.metaPixelId || null;
    if (patch.tiktokPixelId !== undefined)
      stream.tiktokPixelId = patch.tiktokPixelId || null;
    if (patch.postbackUrl !== undefined) {
      if (patch.postbackUrl) await this.assertPostbackUrl(patch.postbackUrl);
      stream.postbackUrl = patch.postbackUrl || null;
    }
    if (patch.postbackSecret !== undefined)
      stream.postbackSecretEnc = patch.postbackSecret
        ? encryptSecret(patch.postbackSecret, this.secretKey())
        : null;
    if (patch.capiToken !== undefined)
      stream.capiTokenEnc = patch.capiToken
        ? encryptSecret(patch.capiToken, this.secretKey())
        : null;

    const saved = await this.streams.save(stream);
    const [counts] = await this.counts([saved.id]);
    return this.toDto(saved, offer, counts ?? { clicks: 0, leads: 0 });
  }

  /** «Mening sahifalarim» (SOT-3). */
  async list(
    affiliateId: string,
    page = 1,
    limit = 20,
  ): Promise<AffiliateStreamsPageDto> {
    const [rows, total] = await this.streams.findAndCount({
      where: { affiliateId, isDeleted: false },
      order: { id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const offers = rows.length
      ? await this.catalog.list({
          productIds: [...new Set(rows.map((r) => r.productId))],
        })
      : [];
    const byProduct = new Map(offers.map((o) => [o.productId, o]));
    const counts = await this.counts(rows.map((r) => r.id));
    const byStream = new Map(
      rows.map((r, i) => [r.id, counts[i] ?? { clicks: 0, leads: 0 }]),
    );
    return {
      items: rows.map((r) =>
        this.toDto(r, byProduct.get(r.productId) ?? null, byStream.get(r.id)!),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Sotuvchi bloklanganda uning hamma sahifasi to‘xtaydi (TC11: «bu havola orqali qabul qilinmaydi»);
   * blok olinganda qayta ochiladi. Chaqiruvchi — admin sotuvchini bloklash (BE-27).
   */
  async setAffiliateStreamsStatus(
    affiliateId: string,
    status: AffiliateStreamStatus,
  ): Promise<{ updated: number }> {
    // BE-35: firibgarlik sababli to‘xtatilgan sahifa blok olinganda qayta ochilmaydi
    const res = await this.streams.update(
      status === AffiliateStreamStatus.ACTIVE
        ? { affiliateId, isDeleted: false, fraudStoppedAt: IsNull() }
        : { affiliateId, isDeleted: false },
      { status },
    );
    return { updated: res.affected ?? 0 };
  }

  private async counts(
    streamIds: string[],
  ): Promise<Array<{ clicks: number; leads: number }>> {
    if (!streamIds.length) return [];
    const [clickRows, leadRows] = await Promise.all([
      this.clicks
        .createQueryBuilder('c')
        .select('c.stream_id', 'streamId')
        .addSelect('COUNT(*)::int', 'n')
        .where({ streamId: In(streamIds) })
        .groupBy('c.stream_id')
        .getRawMany<{ streamId: string; n: number }>(),
      this.leads
        .createQueryBuilder('l')
        .select('l.stream_id', 'streamId')
        .addSelect('COUNT(*)::int', 'n')
        .where({ streamId: In(streamIds), isDeleted: false })
        .groupBy('l.stream_id')
        .getRawMany<{ streamId: string; n: number }>(),
    ]);
    const clickBy = new Map(clickRows.map((r) => [String(r.streamId), r.n]));
    const leadBy = new Map(leadRows.map((r) => [String(r.streamId), r.n]));
    return streamIds.map((id) => ({
      clicks: clickBy.get(String(id)) ?? 0,
      leads: leadBy.get(String(id)) ?? 0,
    }));
  }

  private toDto(
    stream: Stream,
    offer: CatalogOfferSnapshot | null,
    counts: { clicks: number; leads: number },
  ): AffiliateStreamDto {
    return {
      id: stream.id,
      code: stream.code,
      link: this.link(stream.code),
      productId: stream.productId,
      productName: offer?.name ?? '',
      template: stream.template,
      salePrice: effectiveSalePrice(Number(stream.salePrice), offer),
      status: stream.status,
      sub1: stream.sub1,
      sub2: stream.sub2,
      sub3: stream.sub3,
      sub4: stream.sub4,
      sub5: stream.sub5,
      metaPixelId: stream.metaPixelId,
      tiktokPixelId: stream.tiktokPixelId,
      postbackUrl: stream.postbackUrl,
      hasPostbackSecret: !!stream.postbackSecretEnc,
      hasCapiToken: !!stream.capiTokenEnc,
      clicks: counts.clicks,
      leads: counts.leads,
      sales: null,
      createdAt: stream.createdAt,
    };
  }

  /** Tayyor havola. Domen EQ-05 da: `LEAD_LANDING_BASE_URL` (masalan https://<domen>). */
  private link(code: string): string {
    const base = (
      this.config.get<string>('LEAD_LANDING_BASE_URL') ?? ''
    ).replace(/\/+$/, '');
    return `${base}/${code}`;
  }

  /** BE-14 TC3, TC4: ichki manzil yoki ichki IP ga ochiladigan domen saqlanmaydi. */
  private async assertPostbackUrl(url: string): Promise<void> {
    try {
      await assertSafeUrlResolved(url, this.resolveHost);
    } catch (err) {
      throw new BadRequestException({
        message: [`postbackUrl ${(err as Error).message}`],
      });
    }
  }

  /** Testlar DNS ni almashtira olishi uchun. */
  resolveHost?: (host: string) => Promise<Array<{ address: string }>>;

  private newCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let code = '';
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    return code;
  }

  private secretKey(): string {
    return this.config.getOrThrow<string>('INTEGRATION_CREDENTIAL_SECRET');
  }
}
