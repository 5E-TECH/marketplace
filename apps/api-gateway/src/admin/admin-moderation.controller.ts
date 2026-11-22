import { Controller, Get, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  CATALOG_MODERATION_RPC,
  ModerationSummaryDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

/** BE-27 (ADM-1): moderatsiya tablari va mahsulot yorliqlari soni — FE-12 «Mahsulot 1 · Narx 3». */
@ApiTags('admin-products')
@ApiBearerAuth()
@Controller('admin/moderation')
export class AdminModerationController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Get('summary')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Moderatsiya hisoblagichlari: tasdiq va narx kutayotganlar, holatlar, qoldiq va partiyalar',
  })
  @ApiOkResponse({ type: ModerationSummaryDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  summary(): Promise<ModerationSummaryDto> {
    return sendRpc(this.catalog, { cmd: CATALOG_MODERATION_RPC.SUMMARY }, {});
  }
}
