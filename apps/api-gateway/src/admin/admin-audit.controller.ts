import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
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

  /**
   * BE-27 TC3 (ADM-6): audit yozuvini o‘chirib bo‘lmaydi — yo‘l bor, lekin har doim 405. Nest yo‘q yo‘lga 404
   * berardi va «yo‘l yo‘q» deb tushunilardi; 405 — «bu amal taqiqlangan». Bazada ham trigger bilan yopiq.
   * BE-25 TC1: ikki yo‘l alohida handler — `{id}` parametri faqat o‘z yo‘lida e’lon qilinadi (OpenAPI talabi).
   */
  @Delete('admin/audit/:id')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Audit yozuvini o‘chirish — taqiqlangan (405)' })
  @ApiParam({ name: 'id', description: 'Audit yozuvi ID si', example: '1501' })
  @ApiResponse({
    status: HttpStatus.METHOD_NOT_ALLOWED,
    description: 'Audit jurnali o‘zgartirilmaydi va o‘chirilmaydi',
  })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  remove(): never {
    return this.forbidden();
  }

  @Delete('admin/audit')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Audit jurnalini tozalash — taqiqlangan (405)' })
  @ApiResponse({
    status: HttpStatus.METHOD_NOT_ALLOWED,
    description: 'Audit jurnali o‘zgartirilmaydi va o‘chirilmaydi',
  })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  removeAll(): never {
    return this.forbidden();
  }

  private forbidden(): never {
    throw new HttpException(
      'Audit yozuvini o‘chirib bo‘lmaydi',
      HttpStatus.METHOD_NOT_ALLOWED,
    );
  }
}
