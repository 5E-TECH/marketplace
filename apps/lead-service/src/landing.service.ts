import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AffiliateStreamStatus,
  CatalogOfferSnapshot,
  CreateLandingClickDto,
  LandingClickCreatedDto,
  LandingPageDto,
  LandingPageSpecDto,
  LandingPageState,
} from '@app/common';
import { CatalogOfferClient } from './catalog-offer.client';
import { Click, OfferContent, Stream } from './entities';

/**
 * Sotuvchi sahifasi uchun ochiq API (BE-11): sahifa ma’lumoti va kliklar.
 * Javobda bazaviy narx, sotuvchi haqi va optovik ma’lumoti yo‘q (TC13). Variant klikka yoziladi,
 * sotuvchi javoblariga chiqmaydi (TC8).
 */
@Injectable()
export class LandingService {
  constructor(
    @InjectRepository(Stream) private readonly streams: Repository<Stream>,
    @InjectRepository(Click) private readonly clicks: Repository<Click>,
    @InjectRepository(OfferContent)
    private readonly contents: Repository<OfferContent>,
    private readonly catalog: CatalogOfferClient,
  ) {}

  async getLanding(code: string): Promise<LandingPageDto> {
    const stream = await this.streamByCode(code);
    const [offer, content] = await Promise.all([
      this.catalog.get(stream.productId),
      this.contents.findOne({
        where: { productId: stream.productId, isDeleted: false },
      }),
    ]);
    if (!offer) throw new NotFoundException('Bunday sotuvchi sahifasi yo‘q');
    return {
      code: stream.code,
      state: landingState(stream, offer),
      template: stream.template,
      product: {
        id: offer.productId,
        name: offer.name,
        subtitle: offer.subtitle,
        images: offer.images,
        videoUrl: offer.videoUrl,
        description: offer.description,
        highlights: content?.highlights ?? [],
        boxContents: content?.boxContents ?? [],
        specs: specsOf(offer),
        isBad: offer.isBad,
      },
      price: {
        salePrice: Number(stream.salePrice),
        centerDeliveryFee: offer.centerDeliveryFee,
        addressDeliveryFee: offer.addressDeliveryFee,
      },
      metaPixelId: stream.metaPixelId,
      tiktokPixelId: stream.tiktokPixelId,
    };
  }

  /** TC7: klik shu sahifa va sotuvchiga yoziladi (sub, utm, variant, IP, user agent bilan). */
  async createClick(
    dto: CreateLandingClickDto,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<LandingClickCreatedDto> {
    const stream = await this.streamByCode(dto.code);
    const click = await this.clicks.save(
      this.clicks.create({
        streamId: stream.id,
        variant: dto.variant ?? null,
        sub1: dto.sub1 ?? null,
        sub2: dto.sub2 ?? null,
        sub3: dto.sub3 ?? null,
        sub4: dto.sub4 ?? null,
        sub5: dto.sub5 ?? null,
        utmSource: dto.utmSource ?? null,
        utmMedium: dto.utmMedium ?? null,
        utmCampaign: dto.utmCampaign ?? null,
        utmContent: dto.utmContent ?? null,
        utmTerm: dto.utmTerm ?? null,
        fbclid: dto.fbclid ?? null,
        fbp: dto.fbp ?? null,
        fbc: dto.fbc ?? null,
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
    return { clickId: click.id };
  }

  private async streamByCode(code: string): Promise<Stream> {
    const stream = await this.streams.findOne({
      where: { code, isDeleted: false },
    });
    if (!stream) throw new NotFoundException('Bunday sotuvchi sahifasi yo‘q');
    return stream;
  }
}

/**
 * Sahifa holati (BE-11 TC10–TC12; holat-matnlari.md sf-landing-toxtatilgan).
 * Sabab → holat moslashuvi [taklif], ega tasdiqlaydi. Sotuvchi bloklangani mijozga aytilmaydi.
 */
export function landingState(
  stream: Pick<Stream, 'status'>,
  offer: CatalogOfferSnapshot,
): LandingPageState {
  if (offer.withdrawn) return LandingPageState.WITHDRAWN;
  if (
    stream.status !== AffiliateStreamStatus.ACTIVE ||
    !offer.cpaAvailable ||
    offer.approvedPrice === null
  )
    return LandingPageState.NOT_ACCEPTED;
  if (offer.stock <= 0) return LandingPageState.OUT_OF_STOCK;
  return LandingPageState.OPEN;
}

/** «Xususiyatlar»: atributlar, og‘irlik, kategoriya [taklif] (holat-matnlari.md standart-1). */
export function specsOf(offer: CatalogOfferSnapshot): LandingPageSpecDto[] {
  const specs = offer.attributes
    .filter((a) => a.name && a.value)
    .map((a) => ({ name: a.name, value: a.value }));
  if (offer.weightGrams && offer.weightGrams > 0)
    specs.push({
      name: 'Og‘irlik',
      value: `${Number((offer.weightGrams / 1000).toFixed(3))} kg`,
    });
  if (offer.categoryName)
    specs.push({ name: 'Kategoriya', value: offer.categoryName });
  return specs;
}
