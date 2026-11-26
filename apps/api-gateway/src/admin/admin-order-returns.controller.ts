import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  Inject,
  Ip,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CreateReturnRequestDto,
  CurrentUser,
  ErrorCode,
  JwtUser,
  RETURN_PHOTO_MAX,
  RETURN_PHOTO_MAX_BYTES,
  RETURN_PHOTO_RPC,
  RPC_TIMEOUT_MS,
  ReturnPhotosResultDto,
  ReturnRequestDetailsDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  StoredReturnPhoto,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { PhotoTooLargeInterceptor } from './photo-too-large.interceptor';

/**
 * BE-44: yetkazilgandan keyin qaytarish so‘rovini xodim mijoz nomidan kiritadi (mijoz qo‘ng‘iroq qiladi —
 * sotuvchi sahifasidagi «So‘rov uchun qo‘ng‘iroq qiling»). Tasdiqlash va rad — `admin/returns/:id/approve|reject`.
 */
@ApiTags('admin-returns')
@ApiBearerAuth()
@Controller('admin/orders')
export class AdminOrderReturnsController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.FILE) private readonly files: ClientProxy,
  ) {}

  @Post(':id/returns')
  // karta: «admin yoki operator» [taklif: nazoratchi ham]; TC6 — sotuvchi va omborchi 403
  @Roles(Role.ADMIN, Role.SUPERADMIN, Role.OPERATOR_LEAD, Role.SUPERVISOR)
  @ApiOperation({
    summary: 'Qaytarish so‘rovini mijoz nomidan kiritish',
    description:
      'Faqat «Yetkazildi» buyurtma, EQ-10 dagi qaytarish muddati ichida (`RETURN_WINDOW_DAYS`), sabab majburiy ' +
      '(`OTHER` da izoh ham). Buyurtma RETURN_REQUESTED; tarixda kiritgan xodim.',
  })
  @ApiCreatedResponse({ type: ReturnRequestDetailsDto })
  @ApiBadRequestResponse({
    description:
      'Sababsiz, muddat o‘tgan, buyurtma «Yetkazildi» emas yoki tovar noto‘g‘ri',
  })
  @ApiConflictResponse({ description: 'Bu buyurtmada ochiq so‘rov bor' })
  async create(
    @Param('id', ParseLeadIdPipe) orderId: string,
    @Body() dto: CreateReturnRequestDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<ReturnRequestDetailsDto> {
    const result = await sendRpc<ReturnRequestDetailsDto>(
      this.checkout,
      { cmd: 'checkout.admin.order-return-create' },
      { orderId, dto, actor: { id: user.sub, role: user.role } },
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: user.sub,
        action: 'return.create',
        entityType: 'ReturnRequest',
        entityId: String(result.id),
        meta: { orderId, reason: dto.reason, ip: ip || null },
      },
    ).catch(() => undefined);
    return result;
  }

  @Post(':id/returns/photos')
  // FE-26: rasm — mijozning shaxsiy ma’lumoti, faqat admin
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Qaytarish so‘roviga mijoz rasmlari (FE-26)',
    description:
      'Qaror berilmagan so‘rovga, jami 3 tagacha, har biri 5 MB gacha (JPG, PNG, WEBP). Yopiq saqlanadi; ochish — `POST admin/returns/{id}/photos/{photoId}/link`.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          maxItems: RETURN_PHOTO_MAX,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiCreatedResponse({ type: ReturnPhotosResultDto })
  @ApiBadRequestResponse({
    description:
      'FILE_REQUIRED — rasm yo‘q; FILE_TYPE_INVALID — rasm emas; bitta so‘rovda 3 tadan ko‘p fayl',
  })
  @ApiPayloadTooLargeResponse({
    description: 'FILE_TOO_LARGE — 5 MB dan katta',
  })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  @ApiConflictResponse({
    description:
      'INVALID_STATE — ochiq so‘rov yo‘q yoki avvalgilari bilan 3 tadan oshadi',
  })
  @UseInterceptors(
    PhotoTooLargeInterceptor,
    FilesInterceptor('files', RETURN_PHOTO_MAX, {
      limits: {
        fileSize: RETURN_PHOTO_MAX_BYTES + 1,
        files: RETURN_PHOTO_MAX,
      },
    }),
  )
  async photos(
    @Param('id', ParseLeadIdPipe) orderId: string,
    @UploadedFiles() uploads: Express.Multer.File[] | undefined,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<ReturnPhotosResultDto> {
    const chosen = (uploads ?? []).filter((file) => file.size > 0);
    if (!chosen.length)
      throw new BadRequestException({
        message: 'Rasm tanlanmagan',
        errorCode: ErrorCode.FILE_REQUIRED,
      });
    const { returnId } = await sendRpc<{ returnId: string }>(
      this.checkout,
      { cmd: RETURN_PHOTO_RPC.CHECK },
      { orderId, count: chosen.length },
    );
    const stored: StoredReturnPhoto[] = [];
    let adding = false;
    let result: ReturnPhotosResultDto;
    try {
      for (const file of chosen)
        stored.push(
          await sendRpc<StoredReturnPhoto>(
            this.files,
            { cmd: RETURN_PHOTO_RPC.STORE },
            // mijoz rasmi navbatda diskka yozilmasin
            new RmqRecordBuilder({
              returnId,
              base64: file.buffer.toString('base64'),
              deadline: Date.now() + RPC_TIMEOUT_MS,
            })
              .setOptions({ persistent: false })
              .build(),
          ),
        );
      adding = true;
      result = await sendRpc<ReturnPhotosResultDto>(
        this.checkout,
        { cmd: RETURN_PHOTO_RPC.ADD },
        { orderId, returnId, files: stored, actorId: user.sub },
      );
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      // ADD javobi kelmagan (5xx) — so‘rovga yozilgan bo‘lishi mumkin: rasmga tegilmaydi, audit qoladi
      if (adding && status >= 500)
        this.auditPhotos(user.sub, returnId, {
          orderId,
          count: stored.length,
          unknown: true,
          ip,
        });
      else await this.discard(stored);
      throw error;
    }
    this.auditPhotos(user.sub, returnId, {
      orderId,
      count: stored.length,
      ip,
    });
    return result;
  }

  private auditPhotos(
    actorId: string,
    returnId: string,
    meta: { orderId: string; count: number; ip: string; unknown?: true },
  ): void {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action: 'return.photos.add',
        entityType: 'ReturnRequest',
        entityId: returnId,
        meta: { ...meta, ip: meta.ip || null },
      },
    ).catch(() => undefined);
  }

  /** So‘rovga yozilmagan rasmlar qolmasin. */
  private async discard(stored: StoredReturnPhoto[]): Promise<void> {
    await Promise.allSettled(
      stored.map((file) =>
        sendRpc(
          this.files,
          { cmd: RETURN_PHOTO_RPC.REMOVE },
          { objectKey: file.objectKey },
        ),
      ),
    );
  }
}
