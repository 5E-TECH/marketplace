import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AffiliateOffersQueryDto,
  AffiliateStreamStatus,
  CreateLandingClickDto,
  RpcHttpExceptionFilter,
  UpdateAffiliateStreamDto,
  UpdateOfferContentDto,
  LEAD_OFFER_AFFILIATES_RPC,
} from '@app/common';
import { LandingService } from './landing.service';
import { OfferService } from './offer.service';
import { PostbackService } from './postback.service';
import { CapiService } from './capi.service';
import { StreamService } from './stream.service';

/** BE-11 RPC lari: offerlar, sotuvchi sahifalari, ochiq sahifa va kliklar, offer matnlari. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadOfferController {
  constructor(
    private readonly offers: OfferService,
    private readonly streams: StreamService,
    private readonly landing: LandingService,
    private readonly postbacks: PostbackService,
    private readonly capi: CapiService,
  ) {}

  /** BE-47: notification — «Offer qoldig‘i tugadi» qabul qiluvchilari. */
  @MessagePattern({ cmd: LEAD_OFFER_AFFILIATES_RPC })
  offerAffiliates(@Payload() input: { productId: string }) {
    return this.streams.affiliatesOf(String(input?.productId ?? ''));
  }

  @MessagePattern({ cmd: 'lead.offer.list' })
  listOffers(@Payload() input: { query: AffiliateOffersQueryDto }) {
    return this.offers.listForAffiliate(input.query ?? {});
  }

  @MessagePattern({ cmd: 'lead.stream.create' })
  createStream(@Payload() input: { affiliateId: string; productId: string }) {
    return this.streams.create(input.affiliateId, input.productId);
  }

  @MessagePattern({ cmd: 'lead.stream.list' })
  listStreams(
    @Payload() input: { affiliateId: string; page?: number; limit?: number },
  ) {
    return this.streams.list(input.affiliateId, input.page, input.limit);
  }

  @MessagePattern({ cmd: 'lead.stream.update' })
  updateStream(
    @Payload()
    input: {
      affiliateId: string;
      streamId: string;
      patch: UpdateAffiliateStreamDto;
    },
  ) {
    return this.streams.update(input.affiliateId, input.streamId, input.patch);
  }

  /** Admin sotuvchini bloklasa / blokdan chiqarsa (BE-27): uning hamma sahifasi to‘xtaydi yoki ochiladi. */
  @MessagePattern({ cmd: 'lead.affiliate.streams.set-status' })
  setAffiliateStreamsStatus(
    @Payload() input: { affiliateId: string; status: AffiliateStreamStatus },
  ) {
    return this.streams.setAffiliateStreamsStatus(
      input.affiliateId,
      input.status,
    );
  }

  @MessagePattern({ cmd: 'lead.postback.journal' })
  postbackJournal(
    @Payload()
    input: {
      affiliateId: string;
      query: { page?: number; limit?: number; streamId?: string };
    },
  ) {
    return this.postbacks.journal(input.affiliateId, input.query ?? {});
  }

  /** BE-31: Meta CAPI yuborish jurnali (FE-28). */
  @MessagePattern({ cmd: 'lead.capi.journal' })
  capiJournal(
    @Payload()
    input: {
      affiliateId: string;
      query: { page?: number; limit?: number; streamId?: string };
    },
  ) {
    return this.capi.journal(input.affiliateId, input.query ?? {});
  }

  @MessagePattern({ cmd: 'lead.landing.get' })
  getLanding(@Payload() input: { code: string }) {
    return this.landing.getLanding(input.code);
  }

  @MessagePattern({ cmd: 'lead.click.create' })
  createClick(
    @Payload()
    input: {
      click: CreateLandingClickDto;
      ip: string | null;
      userAgent: string | null;
    },
  ) {
    return this.landing.createClick(input.click, {
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  @MessagePattern({ cmd: 'lead.offer-content.get' })
  getContent(@Payload() input: { productId: string }) {
    return this.offers.getContent(input.productId);
  }

  @MessagePattern({ cmd: 'lead.offer-content.update' })
  updateContent(
    @Payload()
    input: {
      productId: string;
      actorId: string;
      content: UpdateOfferContentDto;
    },
  ) {
    return this.offers.updateContent(
      input.productId,
      input.actorId,
      input.content,
    );
  }
}
