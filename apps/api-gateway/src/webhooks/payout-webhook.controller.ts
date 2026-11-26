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
  PAYOUT_EVENTS,
  PayoutCardBoundEvent,
  PayoutStatusEvent,
  PayoutWebhookDto,
  payoutKey,
  Public,
  rawResponse,
  RmqClient,
  sealPayoutToken,
  verifyHmacSha256,
} from '@app/common';

/** Hodisani navbatga yozish chegarasi: yozilmasa 503 — provayder qayta yuboradi. */
const EMIT_TIMEOUT_MS = 5_000;

/**
 * BE-32 (MOL-6): kartaga to‘lov provayderi hodisalari → finance. Imzo — `X-Payout-Signature` (HMAC-SHA256, hex, xom tana).
 * Karta tokeni shu yerda `PAYOUT_SECRET_KEY` bilan shifrlanadi — navbatda va DLQ da ochiq token yo‘q. Provayder yuborgan
 * ortiqcha maydonlar (masalan, to‘liq karta raqami) navbatga tushmaydi. Takror `eventId` finance da bir marta ishlanadi.
 */
@ApiTags('webhooks')
@Public()
@Controller('webhooks/payout')
export class PayoutWebhookController {
  private readonly logger = new Logger(PayoutWebhookController.name);

  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Kartaga to‘lov provayderi hodisalari (BE-32)',
    description:
      '`card.bound` — sotuvchi kartani provayder sahifasida uladi (token va niqob); `payout.status` — to‘lov natijasi. 503 bo‘lsa provayder qayta yuboradi; takror `eventId` xavfsiz.',
  })
  @ApiHeader({ name: 'X-Payout-Signature', required: true })
  @ApiBody({ type: PayoutWebhookDto })
  @ApiOkResponse({ schema: { example: { received: true } } })
  @ApiUnauthorizedResponse({ description: 'Imzo yo‘q yoki noto‘g‘ri' })
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-payout-signature') signature: string | undefined,
  ) {
    const secret = this.config.get<string>('PAYOUT_WEBHOOK_SECRET')?.trim();
    const rawBody = request.rawBody?.toString('utf8');
    if (!secret || !signature || !rawBody)
      throw new UnauthorizedException('Webhook imzosi topilmadi');
    if (!verifyHmacSha256(rawBody, signature, secret))
      throw new UnauthorizedException('Webhook imzosi noto‘g‘ri');
    const dto = plainToInstance(PayoutWebhookDto, request.body);
    const errors =
      dto && typeof dto === 'object' && !Array.isArray(dto)
        ? validateSync(dto).flatMap((error) =>
            Object.values(error.constraints ?? {}),
          )
        : ['tana obyekt bo‘lishi kerak'];
    if (errors.length) throw new BadRequestException(errors);
    const key = payoutKey(this.config);
    if (!key) {
      this.logger.error(
        'PAYOUT_SECRET_KEY sozlanmagan — to‘lov hodisasi qabul qilinmadi',
      );
      throw new ServiceUnavailableException('Hodisa qabul qilinmadi');
    }
    const { pattern, payload } = toPayoutEvent(dto, key);
    try {
      await firstValueFrom(
        this.finance.emit(pattern, payload).pipe(timeout(EMIT_TIMEOUT_MS)),
        { defaultValue: undefined },
      );
    } catch (error) {
      this.logger.error(
        `To‘lov hodisasi navbatga yozilmadi (${dto.eventId}): ${(error as Error)?.message}`,
      );
      throw new ServiceUnavailableException('Hodisa qabul qilinmadi');
    }
    return rawResponse({ received: true });
  }
}

/** Faqat kerakli maydonlar; token shifrlanadi. */
export function toPayoutEvent(
  dto: PayoutWebhookDto,
  key: string,
): { pattern: string; payload: PayoutCardBoundEvent | PayoutStatusEvent } {
  if (dto.type === 'card.bound')
    return {
      pattern: PAYOUT_EVENTS.CARD_BOUND,
      payload: {
        eventId: dto.eventId,
        sessionRef: dto.sessionRef!,
        tokenCipher: sealPayoutToken(dto.cardToken!, key),
        mask: dto.mask!,
        system: dto.system ?? null,
        holderName: dto.holderName?.trim() || null,
      },
    };
  return {
    pattern: PAYOUT_EVENTS.STATUS,
    payload: {
      eventId: dto.eventId,
      payoutRef: dto.payoutRef!,
      status: dto.status!,
      reason: dto.reason?.trim() || null,
    },
  };
}
