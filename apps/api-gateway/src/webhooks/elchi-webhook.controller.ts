import {
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  ElchiWebhookDto,
  Public,
  rawResponse,
  RmqClient,
  sendRpc,
  verifyHmacSha256,
} from '@app/common';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

@ApiTags('webhooks')
@Public()
@Controller('webhooks/elchi')
export class ElchiWebhookController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Elchi shipment status webhook receiver' })
  @ApiHeader({ name: 'X-Elchi-Signature', required: true })
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-elchi-signature') signature: string | undefined,
    @Body() body: ElchiWebhookDto,
  ) {
    const secret = this.config.get<string>('ELCHI_WEBHOOK_SECRET');
    const rawBody = request.rawBody?.toString('utf8');
    if (!secret || !signature || !rawBody) {
      throw new UnauthorizedException('Webhook imzosi topilmadi');
    }
    if (!verifyHmacSha256(rawBody, signature, secret)) {
      throw new UnauthorizedException('Webhook imzosi noto‘g‘ri');
    }
    const occurredAt = Date.parse(body.occurredAt);
    if (
      !Number.isFinite(occurredAt) ||
      Math.abs(Date.now() - occurredAt) > MAX_CLOCK_SKEW_MS
    ) {
      throw new UnauthorizedException(
        'Webhook vaqti ruxsat etilgan oynadan tashqarida',
      );
    }

    const result = await sendRpc<{ received: true; duplicate?: boolean }>(
      this.checkout,
      { cmd: 'checkout.elchi-webhook.process' },
      body,
    );
    return rawResponse(result);
  }
}
