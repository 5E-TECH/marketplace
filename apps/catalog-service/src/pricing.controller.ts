import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ElchiTariffDto,
  LEAD_CATALOG_RPC,
  MarketCheckDto,
  PriceDecisionDto,
  PricePolicyDto,
  PricingQueryDto,
  RpcHttpExceptionFilter,
} from '@app/common';
import { PricePolicyScope } from './entities/pricing.entity';
import { PricingService } from './pricing.service';

/** BE-09: narx kalkulyatori — admin API (gateway) va lead-service uchun yetkazish narxi. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @MessagePattern({ cmd: 'catalog.pricing.calculate' })
  calculate(@Payload() data: { productId: string; query?: PricingQueryDto }) {
    return this.pricing.calculate(String(data.productId), data.query ?? {});
  }

  @MessagePattern({ cmd: 'catalog.pricing.decide' })
  decide(
    @Payload()
    data: {
      productId: string;
      actorId: string;
      dto: PriceDecisionDto;
    },
  ) {
    return this.pricing.decide(
      String(data.productId),
      String(data.actorId),
      data.dto,
    );
  }

  @MessagePattern({ cmd: 'catalog.pricing.history' })
  history(@Payload() data: { productId: string }) {
    return this.pricing.history(String(data.productId));
  }

  @MessagePattern({ cmd: 'catalog.pricing.market-check' })
  market(@Payload() data: { productId: string; dto: MarketCheckDto }) {
    return this.pricing.marketCheck(String(data.productId), {
      ...data.dto,
      competitorTotal: Number(data.dto.competitorTotal),
    });
  }

  @MessagePattern({ cmd: 'catalog.pricing.policy-get' })
  getPolicy(
    @Payload() data: { scope: PricePolicyScope; scopeId?: string | null },
  ) {
    return this.pricing.getPolicy(data.scope, data.scopeId ?? null);
  }

  @MessagePattern({ cmd: 'catalog.pricing.policy-set' })
  setPolicy(
    @Payload()
    data: {
      scope: PricePolicyScope;
      scopeId?: string | null;
      dto: PricePolicyDto;
      actorId: string;
    },
  ) {
    return this.pricing.setPolicy(
      data.scope,
      data.scopeId ?? null,
      data.dto,
      String(data.actorId),
    );
  }

  @MessagePattern({ cmd: 'catalog.pricing.tariff-list' })
  listTariffs() {
    return this.pricing.listTariffs();
  }

  @MessagePattern({ cmd: 'catalog.pricing.tariff-add' })
  addTariff(@Payload() data: { dto: ElchiTariffDto; actorId: string }) {
    return this.pricing.addTariff(data.dto, String(data.actorId));
  }

  /** BE-11 shartnomasi: { productId, quantity, whereDeliver } → { deliveryFee } (FE-09 TC3). */
  @MessagePattern({ cmd: LEAD_CATALOG_RPC.OFFER_QUOTE })
  quote(
    @Payload()
    data: {
      productId: string;
      quantity: number;
      whereDeliver: string;
    },
  ) {
    return this.pricing.quote(
      String(data.productId),
      Number(data.quantity),
      String(data.whereDeliver),
    );
  }
}
