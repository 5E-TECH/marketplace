import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  HandoverActView,
  JwtUser,
  PickListPage,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  WAREHOUSE_RPC,
  WarehouseHandoverDto,
  WarehousePickListQueryDto,
  WarehouseScanDto,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { LabelDocument, labelPdf } from '../orders/label-pdf';
import {
  HANDOVER_ACT_EXAMPLE,
  PACK_EXAMPLE,
  PICK_LIST_EXAMPLE,
  SCAN_EXAMPLE,
} from './warehouse.examples';

/**
 * Ombor (BE-19; TZ 6.6 OMB-2, OMB-4, OMB-5): kunlik yig‘ish ro‘yxati, skaner, qadoq, yorliq va Elchi’ga topshirish
 * akti. Omborchi, admin va superadmin (TZ 3-bo‘lim).
 */
@ApiTags('warehouse')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.WAREHOUSE, Role.SUPERADMIN)
@Controller('warehouse')
export class WarehouseController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  @Get('pick-list')
  @ApiOperation({
    summary: 'Kunlik yig‘ish ro‘yxati',
    description:
      '14:00 gacha (Toshkent) tasdiqlangan buyurtma — o‘sha kuni, keyin — ertasi kuni (OMB-4). Oldingi kunlardan qolganlar `overdue` bilan.',
  })
  @ApiOkResponse({
    description:
      'Sahifalashsiz, 1 000 qatorgacha; oshsa `truncated: true`. Topshirilgan va bekor qilingan vazifalar chiqmaydi.',
    schema: { example: PICK_LIST_EXAMPLE },
  })
  pickList(@Query() query: WarehousePickListQueryDto): Promise<PickListPage> {
    return sendRpc(
      this.checkout,
      { cmd: WAREHOUSE_RPC.PICK_LIST },
      { date: query.date },
    );
  }

  @Post('tasks/:id/scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tovarni skanerlash (shtrix-kod yoki SKU)',
    description:
      'Buyurtmadagi tovar emas — 409 `WRONG_ITEM` (jurnalda). Birinchi to‘g‘ri skaner — buyurtma «Yig‘ilmoqda», hamma dona — vazifa «Yig‘ildi».',
  })
  @ApiOkResponse({ schema: { example: SCAN_EXAMPLE } })
  @ApiConflictResponse({
    description: 'WRONG_ITEM — boshqa tovar; INVALID_STATE — vazifa holati',
  })
  scan(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: WarehouseScanDto,
    @CurrentUser() user: JwtUser,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: WAREHOUSE_RPC.SCAN },
      { taskId: id, code: dto.code, actor: { id: user.sub, role: user.role } },
    );
  }

  @Post('tasks/:id/pack')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Qadoqlandi (hamma dona to‘g‘ri skanerlangandan keyin)',
  })
  @ApiOkResponse({ schema: { example: PACK_EXAMPLE } })
  @ApiConflictResponse({ description: 'INVALID_STATE — hali yig‘ilmagan' })
  pack(@Param('id', ParseLeadIdPipe) id: string, @CurrentUser() user: JwtUser) {
    return sendRpc(
      this.checkout,
      { cmd: WAREHOUSE_RPC.PACK },
      { taskId: id, actor: { id: user.sub, role: user.role } },
    );
  }

  @Get('orders/:id/label')
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary:
      'Posilka yorlig‘i (100×60 mm): Elchi raqami, QR, tasdiqlangan manzil',
  })
  @ApiOkResponse({
    description: 'Chop etishga tayyor PDF yorliq',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  @ApiConflictResponse({ description: 'Elchi posilkasi hali yaratilmagan' })
  async label(
    @Param('id', ParseLeadIdPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await sendRpc<LabelDocument>(
      this.checkout,
      { cmd: WAREHOUSE_RPC.LABEL },
      { orderId: id },
    );
    return labelPdf(res, document);
  }

  @Post('handover-acts')
  @ApiOperation({
    summary: 'Elchi’ga topshirish akti (skanerlangan QR lar)',
    description:
      'Har posilka qadoqlangan va Elchi posilkasi yaratilgan bo‘lishi kerak — bittasi ham tayyor bo‘lmasa butun akt rad (409, sabablar bilan). Aktdagi son = topshirilgan posilkalar (OMB-5).',
  })
  @ApiCreatedResponse({
    description:
      'Akt: raqam, sana, posilkalar. Xuddi shu QR to‘plami qayta yuborilsa — o‘sha akt',
    schema: { example: HANDOVER_ACT_EXAMPLE },
  })
  @ApiConflictResponse({
    description: 'Akt tuzilmadi: qaysi posilka va nima uchun',
  })
  handover(
    @Body() dto: WarehouseHandoverDto,
    @CurrentUser() user: JwtUser,
  ): Promise<HandoverActView> {
    return sendRpc(
      this.checkout,
      { cmd: WAREHOUSE_RPC.HANDOVER },
      { qrTokens: dto.qrTokens, actor: { id: user.sub, role: user.role } },
    );
  }

  @Get('handover-acts/:id')
  @ApiOperation({ summary: 'Topshirish akti' })
  @ApiOkResponse({ schema: { example: HANDOVER_ACT_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Akt topilmadi' })
  act(@Param('id', ParseLeadIdPipe) id: string): Promise<HandoverActView> {
    return sendRpc(this.checkout, { cmd: WAREHOUSE_RPC.ACT_GET }, { id });
  }

  @Get('handover-acts/:id/pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Topshirish akti PDF (imzo uchun)' })
  @ApiOkResponse({
    description: 'PDF fayl (imzo uchun)',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiNotFoundResponse({ description: 'Akt topilmadi' })
  async actPdf(
    @Param('id', ParseLeadIdPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await sendRpc<LabelDocument>(
      this.checkout,
      { cmd: WAREHOUSE_RPC.ACT_PDF },
      { id },
    );
    return labelPdf(res, document);
  }
}
