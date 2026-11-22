import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  PLATFORM_METRICS_RPC,
  PlatformFinanceMetricsDto,
  PlatformLeadMetricsDto,
  PlatformMetricsDto,
  PlatformMetricsGroupBy,
  PlatformMetricsQueryDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';

/**
 * BE-46 (FE-22, ADM-5, TZ 9-bo‘lim): platforma ko‘rsatkichlari — faqat ADMIN va SUPERADMIN (TC5).
 * Lid voronkasi lead-service dan (BE-28 ta’riflari bilan, TC2), moliya qismi (hissa, sverka farqi, pul yechish
 * muddati) finance dan — faqat kun kesimida. Upsell (9-bo‘lim, 7-qator) 2-bosqichda.
 */
@ApiTags('admin-metrics')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/metrics')
export class AdminMetricsController {
  constructor(
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Platforma ko‘rsatkichlari (TZ 9): kun, sotuvchi, operator yoki offer kesimida',
    description:
      'Davr — Toshkent kunlari, `to` kiradi, ko‘pi bilan 366 kun. Har ko‘rsatkich o‘z hodisasi kuni bo‘yicha (lid — kelgan, tasdiq — tasdiqlangan, sotuv — yetkazilgan kuni). Moliya qismi faqat kun kesimida, boshqa kesimda null.',
  })
  @ApiOkResponse({ type: PlatformMetricsDto })
  @ApiForbiddenResponse({ description: 'ADMIN va SUPERADMIN dan boshqa rol' })
  async metrics(
    @Query() query: PlatformMetricsQueryDto,
  ): Promise<PlatformMetricsDto> {
    const groupBy = query.groupBy ?? PlatformMetricsGroupBy.DAY;
    const [leads, finance] = await Promise.all([
      sendRpc<PlatformLeadMetricsDto>(
        this.lead,
        { cmd: PLATFORM_METRICS_RPC.LEADS },
        { from: query.from, to: query.to, groupBy },
      ),
      groupBy === PlatformMetricsGroupBy.DAY
        ? sendRpc<PlatformFinanceMetricsDto>(
            this.finance,
            { cmd: PLATFORM_METRICS_RPC.FINANCE },
            { from: query.from, to: query.to },
          )
        : Promise.resolve(null),
    ]);
    return { from: query.from, to: query.to, groupBy, leads, finance };
  }
}
