import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateFraudIncidentDto,
  CurrentUser,
  FraudActionPageDto,
  FraudActionQueryDto,
  FraudActionType,
  FraudDecisionDto,
  FraudIncidentDetailDto,
  FraudIncidentPageDto,
  FraudIncidentQueryDto,
  FraudIncidentStatus,
  LeadErrorCode,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';
import { ParseLeadIdPipe } from './lead-id.pipe';

/**
 * Firibgarlik markazi (ADM-4, TZ 7-bo‘lim; BE-35; dizayn E-Admin-Firibgarlik). Faqat ADMIN va SUPERADMIN
 * (TZ 3: admin — «firibgarlik nazorati»).
 */
@ApiTags('admin-fraud')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/fraud')
export class AdminFraudController {
  constructor(
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get('incidents')
  @ApiOperation({
    summary: 'Hodisalar: ochiq, yopilgan yoki hammasi; qoida va davr bo‘yicha',
  })
  @ApiOkResponse({ type: FraudIncidentPageDto })
  list(@Query() query: FraudIncidentQueryDto): Promise<FraudIncidentPageDto> {
    return sendRpc(this.lead, { cmd: 'lead.fraud.list' }, { query });
  }

  @Get('incidents/:id')
  @ApiOperation({
    summary: 'Hodisa: dalil va shu hodisa (sahifa) bo‘yicha choralar',
  })
  @ApiOkResponse({ type: FraudIncidentDetailDto })
  @ApiNotFoundResponse({ description: 'Hodisa topilmadi' })
  get(
    @Param('id', ParseLeadIdPipe) id: string,
  ): Promise<FraudIncidentDetailDto> {
    return sendRpc(this.lead, { cmd: 'lead.fraud.get' }, { id });
  }

  @Post('incidents')
  @ApiOperation({
    summary: 'Hodisani qo‘lda ochish',
    description:
      'Avtomatik chegara TZ da yo‘q xavflar uchun: soxta tasdiq, mijoz bazasini o‘g‘irlash, aldovli reklama, bir qurilma yoki manzildan ko‘p buyurtma.',
  })
  @ApiOkResponse({ type: FraudIncidentDetailDto })
  @ApiConflictResponse({
    description: 'Shu qoida va obyekt bo‘yicha ochiq hodisa bor',
  })
  create(
    @CurrentUser('sub') actorId: string,
    @Body() incident: CreateFraudIncidentDto,
  ): Promise<FraudIncidentDetailDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.fraud.create' },
      { actorId, incident },
    );
  }

  @Post('incidents/:id/decision')
  @ApiOperation({
    summary: 'Qaror: chora yoki «Asossiz»',
    description:
      'Sabab va dalil majburiy; choralar tarixiga yoziladi. BLOCK_AFFILIATE — sotuvchi akkaunti bloklanadi (identity), sahifalari to‘xtaydi, ushlangan haqi bekor qilinadi. HOLD_FEE dan keyin hodisa ochiq qoladi.',
  })
  @ApiOkResponse({ type: FraudIncidentDetailDto })
  @ApiBadRequestResponse({
    description: 'FRAUD_ACTION_NOT_APPLICABLE — chora hodisaga mos emas',
  })
  @ApiConflictResponse({ description: 'FRAUD_INCIDENT_CLOSED' })
  async decide(
    @CurrentUser('sub') actorId: string,
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() decision: FraudDecisionDto,
  ): Promise<FraudIncidentDetailDto> {
    if (decision.action === FraudActionType.BLOCK_AFFILIATE) {
      // Avval hodisa ochiqligi va sotuvchisi tekshiriladi, keyin identity (takroriy blok zararsiz), so‘ng qaror.
      const incident = await sendRpc<FraudIncidentDetailDto>(
        this.lead,
        { cmd: 'lead.fraud.get' },
        { id },
      );
      if (incident.status !== FraudIncidentStatus.OPEN)
        return sendRpc(
          this.lead,
          { cmd: 'lead.fraud.decide' },
          { actorId, id, decision },
        );
      if (!incident.affiliateId)
        throw new BadRequestException({
          message: 'Bu chora uchun hodisada sotuvchi yo‘q',
          errorCode: LeadErrorCode.FRAUD_ACTION_NOT_APPLICABLE,
        });
      await sendRpc(
        this.identity,
        { cmd: 'identity.user.set-blocked' },
        { actorId, userId: incident.affiliateId, blocked: true },
      );
    }
    return sendRpc(
      this.lead,
      { cmd: 'lead.fraud.decide' },
      { actorId, id, decision },
    );
  }

  @Get('actions')
  @ApiOperation({
    summary: 'Choralar tarixi (o‘chirib bo‘lmaydi); telefon niqoblangan',
  })
  @ApiOkResponse({ type: FraudActionPageDto })
  actions(@Query() query: FraudActionQueryDto): Promise<FraudActionPageDto> {
    return sendRpc(this.lead, { cmd: 'lead.fraud.actions' }, { query });
  }
}
