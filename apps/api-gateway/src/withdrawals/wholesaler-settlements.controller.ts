import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Ip,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CurrentUser,
  FINANCE_SETTLEMENT_RESPONSE_RPC,
  FINANCE_SETTLEMENT_RPC,
  JwtUser,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  SettlementCommentDto,
  WholesalerActDto,
  WholesalerOwnSettlementQueryDto,
  WholesalerSettlementPageDto,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { LabelDocument, labelPdf } from '../orders/label-pdf';

/**
 * BE-46 (FE-24, OPT-3, DZ-08): optovik o‘z akt-sverkalarini ko‘radi, qabul qiladi yoki e’tiroz bildiradi.
 * Optovik — foydalanuvchiga bog‘langan katalog optovigi (`catalog.shop.owner_user_id`; kabinet va bog‘lash BE-30).
 * Bog‘lanmagan foydalanuvchi — 403; boshqa optovik akti — 403 (TC4). Har javob audit jurnaliga yoziladi.
 */
@ApiTags('wholesaler')
@ApiBearerAuth()
@Roles(Role.WHOLESALER)
@Controller('wholesaler/settlements')
export class WholesalerSettlementsController {
  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  /** Foydalanuvchining optovigi; bog‘lanmagan bo‘lsa 403 (optovik ID si so‘rovdan olinmaydi). */
  private async wholesalerId(user: JwtUser): Promise<string> {
    let shop: { id?: string | number } | null;
    try {
      shop = await sendRpc<{ id?: string | number } | null>(
        this.catalog,
        { cmd: 'seller.shop.get-me' },
        { ownerUserId: user.sub },
      );
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === 404) shop = null;
      else throw e;
    }
    if (!shop?.id)
      throw new ForbiddenException('Foydalanuvchi optovikka bog‘lanmagan');
    return String(shop.id);
  }

  @Get()
  @ApiOperation({ summary: 'O‘z akt-sverkalarim' })
  @ApiOkResponse({ type: WholesalerSettlementPageDto })
  @ApiForbiddenResponse({ description: 'Foydalanuvchi optovikka bog‘lanmagan' })
  async list(
    @CurrentUser() user: JwtUser,
    @Query() query: WholesalerOwnSettlementQueryDto,
  ): Promise<WholesalerSettlementPageDto> {
    const wholesalerId = await this.wholesalerId(user);
    const page = await sendRpc<WholesalerSettlementPageDto>(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RPC.LIST },
      {
        query: {
          page: query.page,
          limit: query.limit,
          status: query.status,
          periodEnd: query.periodEnd,
          wholesalerId,
        },
      },
    );
    // Optovikka platforma xodimining ichki ID si ko‘rsatilmaydi (kim «To‘landi» bosgan).
    return {
      ...page,
      items: page.items.map((item) => ({ ...item, paidBy: null })),
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Akt, qabul holati va e’tirozlar (moliya javobi bilan)',
  })
  @ApiOkResponse({ type: WholesalerActDto })
  @ApiForbiddenResponse({ description: 'Boshqa optovik akti' })
  async get(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() user: JwtUser,
  ): Promise<WholesalerActDto> {
    const wholesalerId = await this.wholesalerId(user);
    return sendRpc(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.WHOLESALER_GET },
      { id, wholesalerId },
    );
  }

  @Get(':id/act.pdf')
  @ApiOperation({ summary: 'Akt-sverka PDF' })
  @ApiProduces('application/pdf')
  @ApiForbiddenResponse({ description: 'Boshqa optovik akti' })
  async actPdf(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() user: JwtUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const wholesalerId = await this.wholesalerId(user);
    await sendRpc(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.WHOLESALER_GET },
      { id, wholesalerId },
    );
    const file = await sendRpc<LabelDocument>(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RPC.ACT_PDF },
      { id },
    );
    return labelPdf(res, file);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aktni qabul qilish',
    description:
      'Bir marta; takror — o‘sha natija. Ochiq e’tiroz bo‘lsa — 409. To‘lov qabulni kutmaydi [taklif].',
  })
  @ApiOkResponse({ type: WholesalerActDto })
  @ApiForbiddenResponse({ description: 'Boshqa optovik akti' })
  @ApiConflictResponse({
    description: 'Ochiq e’tiroz bor yoki tovarlar qaytgan akt (VOID)',
  })
  async accept(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<WholesalerActDto> {
    const wholesalerId = await this.wholesalerId(user);
    const act = await sendRpc<WholesalerActDto>(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.ACCEPT },
      { id, wholesalerId, userId: user.sub },
    );
    this.audit(user.sub, 'settlement.accept', id, ip, { wholesalerId });
    return act;
  }

  @Post(':id/dispute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'E’tiroz bildirish — moliyaga boradi, javobi shu aktda ko‘rinadi',
  })
  @ApiOkResponse({ type: WholesalerActDto })
  @ApiForbiddenResponse({ description: 'Boshqa optovik akti' })
  @ApiConflictResponse({
    description:
      'Akt qabul qilingan, ochiq e’tiroz bor yoki tovarlar qaytgan akt (VOID)',
  })
  async dispute(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: SettlementCommentDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<WholesalerActDto> {
    const wholesalerId = await this.wholesalerId(user);
    const act = await sendRpc<WholesalerActDto>(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.DISPUTE },
      { id, wholesalerId, userId: user.sub, comment: dto.comment },
    );
    this.audit(user.sub, 'settlement.dispute', id, ip, {
      wholesalerId,
      comment: dto.comment,
    });
    return act;
  }

  private audit(
    actorId: string,
    action: string,
    entityId: string,
    ip: string | undefined,
    meta: Record<string, unknown>,
  ): void {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action,
        entityType: 'WholesalerSettlement',
        entityId,
        meta: { ...meta, ip: ip ?? null },
      },
    ).catch(() => undefined);
  }
}
