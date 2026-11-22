import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateLeadDto,
  PartnerLeadDto,
  RpcHttpExceptionFilter,
  SITE_ORDER_RPC,
  SiteOrderDto,
  SiteOrderLine,
} from '@app/common';
import { ApiKeyService } from './api-key.service';
import { LeadIntakeService } from './lead-intake.service';
import { SiteOrderService } from './site-order.service';

/** POST /leads RPC (BE-12). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadIntakeController {
  constructor(
    private readonly intake: LeadIntakeService,
    private readonly keys: ApiKeyService,
    private readonly site: SiteOrderService,
  ) {}

  /** POST /partner/leads (BE-43): kalit tekshiruvi va chegarasi, keyin BE-12 qoidalari. */
  @MessagePattern({ cmd: 'lead.partner.create' })
  async createFromApi(
    @Payload()
    input: {
      apiKey: string | null;
      idempotencyKey: string | null;
      lead: PartnerLeadDto;
      ip: string | null;
      userAgent: string | null;
    },
  ) {
    const key = await this.keys.authenticate(input.apiKey);
    return this.intake.createFromApi({
      apiKey: { id: key.id, affiliateId: key.affiliateId },
      idempotencyKey: input.idempotencyKey,
      lead: input.lead,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  @MessagePattern({ cmd: 'lead.api-key.create' })
  createKey(@Payload() input: { affiliateId: string }) {
    return this.keys.create(input.affiliateId);
  }

  @MessagePattern({ cmd: 'lead.api-key.list' })
  listKeys(@Payload() input: { affiliateId: string }) {
    return this.keys.list(input.affiliateId);
  }

  @MessagePattern({ cmd: 'lead.api-key.revoke' })
  revokeKey(@Payload() input: { affiliateId: string; id: string }) {
    return this.keys.revoke(input.affiliateId, input.id);
  }

  @MessagePattern({ cmd: 'lead.create' })
  create(
    @Payload()
    input: {
      lead: CreateLeadDto;
      ip: string | null;
      userAgent: string | null;
    },
  ) {
    return this.intake.create(input);
  }

  /** BE-34: POST /storefront/orders — savatdan lid (gateway savat qatorlarini checkout’dan oladi). */
  @MessagePattern({ cmd: SITE_ORDER_RPC.CREATE })
  createFromSite(
    @Payload()
    input: {
      order: SiteOrderDto;
      lines: SiteOrderLine[];
      ip: string | null;
      userAgent: string | null;
    },
  ) {
    return this.site.create(input);
  }

  /** BE-34: SMS havola bosildi. */
  @MessagePattern({ cmd: SITE_ORDER_RPC.CONFIRM })
  confirmFromSite(@Payload() data: { token: string }) {
    return this.site.confirm(String(data?.token ?? ''));
  }
}
