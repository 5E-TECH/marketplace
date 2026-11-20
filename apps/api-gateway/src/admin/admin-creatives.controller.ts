import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CREATIVE_RPC,
  CreativeConfirmDto,
  CreativeDto,
  CreativeUploadPolicyDto,
  CreativeUploadRequestDto,
  CurrentUser,
  JwtUser,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  VerifiedCreativeFile,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';

/**
 * Kreativlar kutubxonasi (BE-08; SOT-9, FE-12): admin mahsulotga video va rasm yuklaydi — moderatsiya yo‘q (sotuvchi
 * yuklamaydi). Yuklash ikki qadamda: imzolangan POST policy olinadi va fayl to‘g‘ridan-to‘g‘ri MinIO ga yuboriladi,
 * keyin tasdiqlanadi (fayl tekshiriladi va kreativ yoziladi).
 */
@ApiTags('admin-creatives')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/products/:id/creatives')
export class AdminCreativesController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.FILE) private readonly files: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Yuklash uchun imzolangan POST (15 daqiqa)',
    description:
      'Fayl `multipart/form-data` bilan `url` ga yuboriladi: avval `fields` (o‘zgartirmasdan), oxirida `file`. Hajm va turni MinIO ham tekshiradi. Sozlamada yo‘q tur yoki katta hajm — 400.',
  })
  @ApiOkResponse({ type: CreativeUploadPolicyDto })
  @ApiBadRequestResponse({
    description: 'Fayl turi yoki hajmi ruxsat etilmagan',
  })
  @ApiNotFoundResponse({ description: 'Mahsulot topilmadi' })
  async uploadPolicy(
    @Param('id', ParseLeadIdPipe) productId: string,
    @Body() dto: CreativeUploadRequestDto,
  ): Promise<CreativeUploadPolicyDto> {
    // mahsulot bor-yo‘qligi (yo‘q mahsulotga fayl yuklanmasin)
    await sendRpc(this.catalog, { cmd: CREATIVE_RPC.LIST }, { productId });
    return sendRpc(
      this.files,
      { cmd: CREATIVE_RPC.UPLOAD_POLICY },
      {
        productId,
        type: dto.type,
        contentType: dto.contentType,
        size: dto.size,
      },
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Yuklangan faylni kreativ qilib saqlash',
    description:
      'Fayl tekshiriladi (bor, hajmi, turi, birinchi baytlari); mos kelmasa o‘chiriladi va 400. Bir mahsulotga 20 tagacha kreativ.',
  })
  @ApiCreatedResponse({ type: CreativeDto })
  @ApiBadRequestResponse({ description: 'Fayl yo‘q yoki mos emas' })
  @ApiConflictResponse({ description: 'Kreativlar chegarasi' })
  async confirm(
    @Param('id', ParseLeadIdPipe) productId: string,
    @Body() dto: CreativeConfirmDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<CreativeDto> {
    const file = await sendRpc<VerifiedCreativeFile>(
      this.files,
      { cmd: CREATIVE_RPC.VERIFY },
      { productId, objectKey: dto.objectKey },
    );
    let creative: CreativeDto;
    try {
      creative = await sendRpc<CreativeDto>(
        this.catalog,
        { cmd: CREATIVE_RPC.CREATE },
        { productId, file, actorId: admin.sub },
      );
    } catch (error) {
      // kreativ yozilmadi (chegara, mahsulot o‘chirilgan) — fayl ochiq papkada qolib ketmasin
      await this.removeFile(file.objectKey);
      throw error;
    }
    this.audit(admin.sub, 'creative.create', creative.id, ip, {
      productId,
      type: creative.type,
      size: creative.size,
    });
    return creative;
  }

  @Get()
  @ApiOperation({ summary: 'Mahsulot kreativlari (tartib bilan)' })
  @ApiOkResponse({ type: [CreativeDto] })
  list(
    @Param('id', ParseLeadIdPipe) productId: string,
  ): Promise<CreativeDto[]> {
    return sendRpc(this.catalog, { cmd: CREATIVE_RPC.LIST }, { productId });
  }

  @Delete(':creativeId')
  @ApiOperation({
    summary: 'Kreativni o‘chirish (offerdan chiqadi, fayl ham o‘chiriladi)',
  })
  @ApiNotFoundResponse({ description: 'Kreativ topilmadi' })
  async remove(
    @Param('id', ParseLeadIdPipe) productId: string,
    @Param('creativeId', ParseLeadIdPipe) creativeId: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<{ id: string }> {
    const deleted = await sendRpc<{ id: string; objectKey: string }>(
      this.catalog,
      { cmd: CREATIVE_RPC.DELETE },
      { productId, creativeId },
    );
    await this.removeFile(deleted.objectKey);
    this.audit(admin.sub, 'creative.delete', deleted.id, ip, { productId });
    return { id: deleted.id };
  }

  private async removeFile(objectKey: string): Promise<void> {
    await sendRpc(
      this.files,
      { cmd: CREATIVE_RPC.REMOVE },
      { objectKey },
    ).catch(() => undefined);
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
        entityType: 'Creative',
        entityId,
        meta: { ...meta, ip: ip ?? null },
      },
    ).catch(() => undefined);
  }
}
