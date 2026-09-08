import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AdminAuditQueryDto,
  AuthErrorResponseDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

/** C6.3 — admin audit jurnalini ko'rish. */
@ApiTags('admin-audit')
@Controller()
export class AdminAuditController {
  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get('admin/audit')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Audit jurnali (actor/action/sana filtr + sahifalash)',
  })
  @ApiOkResponse({ description: '{ items, total, page, limit, totalPages }' })
  @ApiBadRequestResponse({
    description: 'Filtr yoki sahifalash qiymati noto‘g‘ri',
  })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  list(@Query() query: AdminAuditQueryDto) {
    return sendRpc(this.identity, { cmd: 'identity.audit.list' }, { query });
  }
}
