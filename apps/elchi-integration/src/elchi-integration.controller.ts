import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { ORDER_EVENTS, OrderStatusChangedEvent, OPS_RPC } from '@app/common';
import { ParcelService } from './parcel.service';
import {
  ElchiIntegrationService,
  ShopApprovedEvent,
  UpdateMarketTariffsInput,
} from './elchi-integration.service';

@Controller()
export class ElchiIntegrationController {
  constructor(
    private readonly service: ElchiIntegrationService,
    private readonly parcels: ParcelService,
  ) {}

  /** BE-20: «Tasdiqlandi» → posilka navbati; «Bekor qilindi» → bekor qilish. */
  @EventPattern(ORDER_EVENTS.STATUS_CHANGED)
  async onOrderStatusChanged(
    @Payload() event: OrderStatusChangedEvent,
  ): Promise<void> {
    await this.parcels.onOrderStatusChanged(event);
  }

  /** Sotuvchi approve bo'lganda Elchi market provisioning (event-driven). */
  @EventPattern('shop.approved')
  async onShopApproved(@Payload() event: ShopApprovedEvent): Promise<void> {
    await this.service.onShopApproved(event);
  }

  /** Elchi geo (viloyat/tuman) keshini sinxronlash (admin/cron chaqiradi). */
  /** BE-26: monitor — oxirgi N daqiqadagi Elchi API xatolari. */
  @MessagePattern({ cmd: OPS_RPC.ELCHI_ERRORS })
  async apiErrors(@Payload() data: { minutes?: number }) {
    return {
      count: await this.parcels.apiErrorsSince(Number(data?.minutes ?? 5)),
    };
  }

  @MessagePattern({ cmd: 'integration.geo.sync' })
  syncGeo() {
    return this.service.syncGeoCache();
  }

  @MessagePattern({ cmd: 'integration.shipment.create' })
  createShipment(
    @Payload() input: Parameters<ElchiIntegrationService['createShipment']>[0],
  ) {
    return this.service.createShipment(input);
  }

  @MessagePattern({ cmd: 'integration.shipment.get' })
  getShipment(@Payload() input: { shipmentId: string }) {
    return this.service.getShipment(input.shipmentId);
  }

  @MessagePattern({ cmd: 'integration.tariff.get' })
  getTariff(
    @Payload() input: Parameters<ElchiIntegrationService['getTariff']>[0],
  ) {
    return this.service.getTariff(input);
  }

  @MessagePattern({ cmd: 'integration.market.update-tariffs' })
  updateMarketTariffs(@Payload() input: UpdateMarketTariffsInput) {
    return this.service.updateMarketTariffs(input);
  }

  @MessagePattern({ cmd: 'integration.market.sync-tariffs' })
  syncMarketTariffs() {
    return this.service.syncMarketTariffs();
  }

  @MessagePattern({ cmd: 'integration.market.reprovision' })
  reprovisionMarket(@Payload() input: { shopId: string }) {
    return this.service.reprovisionMarket(input.shopId);
  }

  @MessagePattern({ cmd: 'integration.regions.list' })
  getRegions() {
    return this.service.getRegions();
  }

  @MessagePattern({ cmd: 'integration.districts.list' })
  getDistricts(@Payload() input: { regionId: string }) {
    return this.service.getDistricts(input.regionId);
  }
}
