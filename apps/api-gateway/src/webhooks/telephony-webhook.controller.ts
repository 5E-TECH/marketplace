import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Request } from 'express';
import { firstValueFrom, timeout } from 'rxjs';
import {
  CALL_EVENTS,
  CallCompletedEvent,
  CallStatusEvent,
  Public,
  rawResponse,
  RecordingReadyEvent,
  RmqClient,
  TelephonyWebhookDto,
  verifyHmacSha256,
} from '@app/common';

/** Hodisani navbatga yozish chegarasi: yozilmasa 503 — provayder qayta yuboradi. */
const EMIT_TIMEOUT_MS = 5_000;

/**
 * BE-15 (TEL-3, T6): telefoniya provayderi hodisalari → RabbitMQ `call.status`, `call.completed`, `recording.ready`.
 * Imzo — `X-Telephony-Signature: sha256` (HMAC-SHA256, hex, xom tana). Takror hodisa lead-service da `eventId` bo‘yicha
 * bir marta ishlanadi. Provayder (EQ-02) o‘z shaklida yuborsa — shu yerda normal shaklga keltiriladi.
 */
@ApiTags('webhooks')
@Public()
@Controller('webhooks/telephony')
export class TelephonyWebhookController {
  private readonly logger = new Logger(TelephonyWebhookController.name);

  constructor(
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Telefoniya provayderi hodisalari (BE-15)',
    description:
      '`status` — bosqich, `completed` — qo‘ng‘iroq tugadi, `recording` — yozuv tayyor. 503 bo‘lsa provayder qayta yuboradi; takror `eventId` xavfsiz.',
  })
  @ApiHeader({ name: 'X-Telephony-Signature', required: true })
  // faqat hujjat uchun: tana imzo tekshirilgach qo‘lda tekshiriladi (provayder qo‘shimcha maydon yuborishi mumkin)
  @ApiBody({ type: TelephonyWebhookDto })
  @ApiOkResponse({ schema: { example: { received: true } } })
  @ApiUnauthorizedResponse({ description: 'Imzo yo‘q yoki noto‘g‘ri' })
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-telephony-signature') signature: string | undefined,
  ) {
    const secret = this.config.get<string>('TELEPHONY_WEBHOOK_SECRET')?.trim();
    const rawBody = request.rawBody?.toString('utf8');
    if (!secret || !signature || !rawBody)
      throw new UnauthorizedException('Webhook imzosi topilmadi');
    if (!verifyHmacSha256(rawBody, signature, secret))
      throw new UnauthorizedException('Webhook imzosi noto‘g‘ri');
    const dto = plainToInstance(TelephonyWebhookDto, request.body);
    const errors =
      dto && typeof dto === 'object' && !Array.isArray(dto)
        ? validateSync(dto).flatMap((error) =>
            Object.values(error.constraints ?? {}),
          )
        : ['tana obyekt bo‘lishi kerak'];
    if (errors.length) throw new BadRequestException(errors);
    const { pattern, payload } = toEvent(dto);
    try {
      await firstValueFrom(
        this.lead.emit(pattern, payload).pipe(timeout(EMIT_TIMEOUT_MS)),
        { defaultValue: undefined },
      );
    } catch (error) {
      this.logger.error(
        `Telefoniya hodisasi navbatga yozilmadi (${dto.eventId}): ${(error as Error)?.message}`,
      );
      throw new ServiceUnavailableException('Hodisa qabul qilinmadi');
    }
    return rawResponse({ received: true });
  }
}

/** Faqat kerakli maydonlar: provayder yuborgan ortiqcha ma’lumot (masalan, mijoz raqami) navbatga tushmaydi. */
export function toEvent(dto: TelephonyWebhookDto): {
  pattern: string;
  payload: CallStatusEvent | CallCompletedEvent | RecordingReadyEvent;
} {
  const base = { eventId: dto.eventId, callRef: dto.callRef, at: dto.at };
  if (dto.type === 'status')
    return {
      pattern: CALL_EVENTS.STATUS,
      payload: { ...base, status: dto.status! },
    };
  if (dto.type === 'recording')
    return {
      pattern: CALL_EVENTS.RECORDING_READY,
      payload: { ...base, recordingRef: dto.recordingRef! },
    };
  return {
    pattern: CALL_EVENTS.COMPLETED,
    payload: {
      ...base,
      endReason: dto.endReason!,
      answeredAt: dto.answeredAt ?? null,
      durationSeconds: dto.durationSeconds ?? null,
    },
  };
}
