import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AffiliateCreativeType,
  AffiliateOfferDetailDto,
  AffiliateOfferDto,
  AffiliateOfferSort,
  AffiliateOffersPageDto,
  AffiliateOffersQueryDto,
  CatalogOfferSnapshot,
  LeadStatus,
  OfferContentDto,
  UpdateOfferContentDto,
} from '@app/common';
import { CatalogOfferClient } from './catalog-offer.client';
import { Lead, OfferContent } from './entities';
import { maxSalePrice, percent } from './offer-math';

/** Yaroqli lid: yaroqsiz va birlashtirilgandan boshqa hammasi (tasdiq foizining maxraji). */
const NOT_VALID = [LeadStatus.INVALID, LeadStatus.MERGED];

/**
 * Offerlar katalogi sotuvchi uchun (BE-11, SOT-2) va offer matnlari (FE-12).
 * Tasdiq foizi lid-servisdan; EPC va sotilish foizi daromad va yetkazish ma’lumoti kelgach (BE-28).
 */
@Injectable()
export class OfferService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(OfferContent)
    private readonly contents: Repository<OfferContent>,
    private readonly catalog: CatalogOfferClient,
  ) {}

  async listForAffiliate(
    query: AffiliateOffersQueryDto,
  ): Promise<AffiliateOffersPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offers = (
      await this.catalog.list({
        search: query.search,
        categoryId: query.categoryId,
      })
    ).filter((o) => o.cpaAvailable && !o.withdrawn && o.approvedPrice !== null);
    const rates = await this.approveRates(offers.map((o) => o.productId));
    let items = offers.map((o) =>
      this.toDto(o, rates.get(o.productId) ?? null),
    );

    if (query.minApproveRate !== undefined)
      items = items.filter(
        (i) => i.approveRate !== null && i.approveRate >= query.minApproveRate!,
      );
    items.sort(
      this.comparator(query.sort ?? AffiliateOfferSort.NEWEST, offers),
    );

    const total = items.length;
    return {
      items: items.slice((page - 1) * limit, page * limit),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * BE-08 (QA TC5): sotuvchi offer kartasi — kreativlar (video ochiq havola bilan) va tafsilot. Sotuvchiga yopiq
   * offer (CPA o‘chiq, olib tashlangan, narx tasdiqlanmagan) — 404, ro‘yxatdagi bilan bir xil qoida.
   */
  async getForAffiliate(productId: string): Promise<AffiliateOfferDetailDto> {
    const id = String(productId ?? '');
    const o = /^[1-9]\d{0,18}$/.test(id) ? await this.catalog.get(id) : null;
    if (!o || !o.cpaAvailable || o.withdrawn || o.approvedPrice === null)
      throw new NotFoundException('Offer topilmadi');
    const rate = (await this.approveRates([o.productId])).get(o.productId);
    const content = await this.contents.findOne({
      where: { productId: o.productId, isDeleted: false },
    });
    const base = this.toDto(o, rate ?? null);
    return {
      ...base,
      categoryName: o.categoryName,
      subtitle: o.subtitle,
      description: o.description,
      boxContents: content?.boxContents?.length
        ? content.boxContents.join(', ')
        : null,
      weightKg: o.weightGrams === null ? null : o.weightGrams / 1000,
      deliveryMode: null,
      centerDeliveryFee: o.centerDeliveryFee,
      addressDeliveryFee: o.addressDeliveryFee,
      isBad: o.isBad,
      state: base.stock > 0 ? 'OPEN' : 'OUT_OF_STOCK',
      stoppedAt: null,
      stopReason: null,
      onSaleSince: String(o.createdAt).slice(0, 10),
      results: null,
      priceSplit: null,
      creatives: o.creatives.map((c) => ({
        id: c.id,
        type:
          c.type === 'VIDEO'
            ? AffiliateCreativeType.VIDEO
            : AffiliateCreativeType.IMAGE,
        url: c.url,
        caption: null,
        processing: false,
        approvedAt: c.createdAt ?? String(o.createdAt),
      })),
    };
  }

  async getContent(productId: string): Promise<OfferContentDto> {
    const row = await this.contents.findOne({
      where: { productId, isDeleted: false },
    });
    return this.contentDto(productId, row);
  }

  async updateContent(
    productId: string,
    actorId: string,
    dto: UpdateOfferContentDto,
  ): Promise<OfferContentDto> {
    const clean = (list: string[]) =>
      list.map((s) => s.trim()).filter((s) => s.length > 0);
    const existing = await this.contents.findOne({ where: { productId } });
    const row = existing ?? this.contents.create({ productId });
    if (dto.callScript !== undefined)
      row.callScript = dto.callScript?.trim() || null;
    row.highlights = clean(dto.highlights);
    row.boxContents = clean(dto.boxContents);
    row.updatedBy = actorId;
    row.isDeleted = false;
    return this.contentDto(productId, await this.contents.save(row));
  }

  private async approveRates(
    productIds: string[],
  ): Promise<Map<string, number | null>> {
    if (!productIds.length) return new Map();
    const rows = await this.leads
      .createQueryBuilder('l')
      .select('l.product_id', 'productId')
      .addSelect(
        `COUNT(*) FILTER (WHERE l.status NOT IN (:...notValid))::int`,
        'valid',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE l.status = :confirmed)::int`,
        'confirmed',
      )
      .where({ productId: In(productIds), isDeleted: false })
      .setParameters({ notValid: NOT_VALID, confirmed: LeadStatus.CONFIRMED })
      .groupBy('l.product_id')
      .getRawMany<{ productId: string; valid: number; confirmed: number }>();
    return new Map(
      rows.map((r) => [String(r.productId), percent(r.confirmed, r.valid)]),
    );
  }

  private toDto(
    o: CatalogOfferSnapshot,
    approveRate: number | null,
  ): AffiliateOfferDto {
    return {
      productId: o.productId,
      name: o.name,
      imageUrl: o.images[0] ?? null,
      approvedPrice: o.approvedPrice!,
      maxSalePrice: maxSalePrice(o)!,
      affiliateFee: o.affiliateFee ?? 0,
      epc: null,
      approveRate,
      saleRate: null,
      stock: o.stock ?? 0, // noma’lum — 0 ko‘rinadi (yangi sahifa ochilmaydi)
      hasVideo: o.creatives.some((c) => c.type === 'VIDEO') || !!o.videoUrl,
      creatives: o.creatives.map((c) => ({
        id: c.id,
        type:
          c.type === 'VIDEO'
            ? AffiliateCreativeType.VIDEO
            : AffiliateCreativeType.IMAGE,
        url: c.url,
      })),
    };
  }

  /** Bo‘sh qiymatlar oxirida. NEWEST — katalogdagi yaratilish vaqti bo‘yicha. */
  private comparator(sort: AffiliateOfferSort, offers: CatalogOfferSnapshot[]) {
    const createdAt = new Map(offers.map((o) => [o.productId, o.createdAt]));
    const desc = (a: number | null, b: number | null) =>
      a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a;
    return (a: AffiliateOfferDto, b: AffiliateOfferDto): number => {
      switch (sort) {
        case AffiliateOfferSort.FEE:
          return b.affiliateFee - a.affiliateFee;
        case AffiliateOfferSort.EPC:
          return desc(a.epc, b.epc);
        case AffiliateOfferSort.APPROVE_RATE:
          return desc(a.approveRate, b.approveRate);
        default:
          return (createdAt.get(b.productId) ?? '').localeCompare(
            createdAt.get(a.productId) ?? '',
          );
      }
    };
  }

  private contentDto(
    productId: string,
    row: OfferContent | null,
  ): OfferContentDto {
    return {
      productId,
      callScript: row?.callScript ?? null,
      highlights: row?.highlights ?? [],
      boxContents: row?.boxContents ?? [],
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }
}
