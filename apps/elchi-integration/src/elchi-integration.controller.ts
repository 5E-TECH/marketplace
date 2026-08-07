import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  ElchiIntegrationService,
  ShopApprovedEvent,
} from './elchi-integration.service';

@Controller()
export class ElchiIntegrationController {
  constructor(private readonly service: ElchiIntegrationService) {}

  /** Sotuvchi approve bo'lganda Elchi market provisioning (event-driven). */
  @EventPattern('shop.approved')
  async onShopApproved(@Payload() event: ShopApprovedEvent): Promise<void> {
    await this.service.onShopApproved(event);
  }

  /** Elchi geo (viloyat/tuman) keshini sinxronlash (admin/cron chaqiradi). */
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
}
