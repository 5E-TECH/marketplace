import {
  BadRequestException,
  Body,
  CallHandler,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpException,
  Inject,
  Injectable,
  Ip,
  Logger,
  NestInterceptor,
  PayloadTooLargeException,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { catchError, Observable, throwError } from 'rxjs';
import {
  AFFILIATE_AUTH_RPC,
  AFFILIATE_DOCUMENT_RPC,
  AffiliateDocumentFile,
  affiliateFullName,
  AffiliateProfileDto,
  AuthErrorResponseDto,
  CurrentUser,
  ErrorCode,
  JwtUser,
  PINFL,
  pinflKey,
  PRIVATE_DOCUMENT_MAX_BYTES,
  RPC_TIMEOUT_MS,
  sealPinfl,
  SubmitSelfEmployedResult,
  RmqClient,
  Role,
  Roles,
  SELF_EMPLOYED_RPC,
  SelfEmployedDocumentDto,
  SelfEmployedInfoDto,
  sendRpc,
  SubmitSelfEmployedDto,
} from '@app/common';
import { sendPrivateFile } from './private-file-response';

/** Multer chegarasi (413) frontend kutadigan `FILE_TOO_LARGE` kodi bilan. */
@Injectable()
export class FileTooLargeInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof PayloadTooLargeException
            ? new PayloadTooLargeException({
                message: 'Fayl 10 MB dan katta',
                errorCode: ErrorCode.FILE_TOO_LARGE,
              })
            : error,
        ),
      ),
    );
  }
}

/**
 * BE-25 5-tur (FE-04, SOT-1, TZ 8): sotuvchi JShShIR va maqom ma’lumotnomasini yuboradi; moliya tekshiradi
 * (`admin/finance/self-employed`). To‘liq JShShIR javobda, auditda va logda yo‘q.
 */
@ApiTags('affiliate')
@ApiBearerAuth()
@Roles(Role.AFFILIATE)
@Controller('affiliate/self-employed')
export class AffiliateSelfEmployedController {
  private readonly logger = new Logger(AffiliateSelfEmployedController.name);

  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    @Inject(RmqClient.FILE) private readonly files: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  @Post('document')
  // bir IP (mobil operator NAT i) ortida bir necha sotuvchi bo‘lishi mumkin [taklif]
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Maqom ma’lumotnomasini oldindan yuklash (PDF, JPG, PNG, 10 MB gacha)',
    description:
      'Fayl yopiq joyga tushadi va 1 kun ichida ariza bilan yuborilmasa o‘chadi. `documentId` faqat shu sotuvchiga ishlaydi.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: SelfEmployedDocumentDto })
  @ApiBadRequestResponse({
    description:
      'FILE_REQUIRED — fayl yo‘q; FILE_TYPE_INVALID — tur yoki tarkib mos emas',
    type: AuthErrorResponseDto,
  })
  @ApiPayloadTooLargeResponse({
    description: 'FILE_TOO_LARGE — 10 MB dan katta',
    type: AuthErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  @UseInterceptors(
    FileTooLargeInterceptor,
    FileInterceptor('file', {
      // busboy chegaraga teng faylni ham kesadi — aynan 10 MB o‘tsin (ortig‘ini file-service rad etadi)
      limits: { fileSize: PRIVATE_DOCUMENT_MAX_BYTES + 1, files: 1 },
    }),
  )
  uploadDocument(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtUser,
  ): Promise<SelfEmployedDocumentDto> {
    ownOnly(user);
    if (!file?.size)
      throw new BadRequestException({
        message: 'Faylni tanlang',
        errorCode: ErrorCode.FILE_REQUIRED,
      });
    return sendRpc(
      this.files,
      { cmd: AFFILIATE_DOCUMENT_RPC.STORE },
      // shaxsiy hujjat navbatda diskka yozilmasin
      new RmqRecordBuilder({
        affiliateId: user.sub,
        // multer nomni latin1 deb o‘qiydi — kirill va ʻ buzilmasin
        fileName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        base64: file.buffer.toString('base64'),
      })
        .setOptions({ persistent: false })
        .build(),
    );
  }

  @Get('document')
  @ApiOperation({ summary: 'O‘z ma’lumotnomam (oxirgi arizadagi fayl)' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiNotFoundResponse({ description: 'Hujjat yuklanmagan' })
  async document(
    @CurrentUser() user: JwtUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    ownOnly(user);
    const document = await sendRpc<AffiliateDocumentFile>(
      this.finance,
      { cmd: SELF_EMPLOYED_RPC.DOCUMENT_MINE },
      { affiliateId: user.sub },
    );
    return sendPrivateFile(this.files, res, document);
  }

  @Post()
  // bir IP (mobil operator NAT i) ortida bir necha sotuvchi bo‘lishi mumkin [taklif]
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'JShShIR va ma’lumotnomani tekshiruvga yuborish',
    description:
      'Ma’lumotnoma ixtiyoriy. Moliya tasdiqlamaguncha pul yechish yopiq. Profilda ism va familiya bo‘lishi shart.',
  })
  @ApiCreatedResponse({ type: SelfEmployedInfoDto })
  @ApiBadRequestResponse({
    description:
      'PINFL_INVALID, DOCUMENT_NOT_FOUND, PROFILE_NAME_REQUIRED — profilda ism yo‘q',
    type: AuthErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'ALREADY_PENDING — tekshirilmoqda; ALREADY_VERIFIED — tasdiqlangan',
    type: AuthErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'SELF_EMPLOYED_SECRET_KEY sozlanmagan',
  })
  async submit(
    @Body() dto: SubmitSelfEmployedDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<SelfEmployedInfoDto> {
    ownOnly(user);
    const affiliateId = user.sub;
    const pinfl = String(dto.pinfl ?? '').trim();
    if (!PINFL.test(pinfl))
      throw new BadRequestException({
        message: 'JShShIR 14 ta raqamdan iborat',
        errorCode: ErrorCode.PINFL_INVALID,
      });
    const pinflSealed = sealPinfl(pinfl, pinflKey(this.config));
    const fullName = affiliateFullName(
      await sendRpc<AffiliateProfileDto>(
        this.identity,
        { cmd: AFFILIATE_AUTH_RPC.PROFILE_GET },
        { userId: affiliateId },
      ),
    );
    await sendRpc(
      this.finance,
      { cmd: SELF_EMPLOYED_RPC.CHECK },
      { affiliateId, fullName },
    );
    const document = dto.documentId
      ? await sendRpc<AffiliateDocumentFile>(
          this.files,
          { cmd: AFFILIATE_DOCUMENT_RPC.COMMIT },
          {
            affiliateId,
            documentId: dto.documentId,
            deadline: Date.now() + RPC_TIMEOUT_MS,
          },
        )
      : null;
    const { id, info } = await sendRpc<SubmitSelfEmployedResult>(
      this.finance,
      { cmd: SELF_EMPLOYED_RPC.SUBMIT },
      { affiliateId, pinflSealed, fullName, document },
    ).catch((error: unknown) => {
      // aniq rad — ariza yo‘q, ko‘chirilgan fayl ham qolmasin. Natija noma’lum bo‘lsa (500, 504) tegilmaydi.
      if (document && rejected(error))
        void sendRpc(
          this.files,
          { cmd: AFFILIATE_DOCUMENT_RPC.REMOVE },
          { affiliateId, objectKey: document.objectKey },
        ).catch((e: Error) =>
          this.logger.warn(`Ariza fayli o‘chirilmadi: ${e.message}`),
        );
      throw error;
    });
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: affiliateId,
        action: 'self-employed.submit',
        entityType: 'SelfEmployed',
        entityId: id,
        meta: {
          affiliateId,
          pinflLast4: info.pinflLast4,
          document: !!document,
          ip: ip ?? null,
        },
      },
    ).catch((e: Error) =>
      this.logger.warn(`Ariza auditga yozilmadi: ${e.message}`),
    );
    return info;
  }
}

/** JShShIR va hujjat — faqat sotuvchining o‘zi; superadmin «nomidan ko‘rish» rejimida emas (C6.5). */
function ownOnly(user: JwtUser): void {
  if (user.impersonatedBy)
    throw new ForbiddenException(
      'Impersonation rejimida JShShIR va hujjat ochilmaydi va yuborilmaydi',
    );
}

function rejected(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  const status = error.getStatus();
  return status < 500 || status === 503;
}
