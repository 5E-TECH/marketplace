import {
  Body,
  BadRequestException,
  Controller,
  Headers,
  Get,
  Inject,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Res,
  Req,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreatePaymentDto,
  PaymentProvider,
  PaymentResultDto,
  ProviderCallback,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UpsertProviderConfigDto,
} from '@app/common';
import { Request, Response } from 'express';

@ApiTags('payments')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(
    @Inject(RmqClient.PAYMENT) private readonly payment: ClientProxy,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  @Post('payments')
  @ApiOperation({ summary: 'Online to‘lov yozuvini yaratish' })
  @ApiCreatedResponse({ type: PaymentResultDto })
  async create(
    @Body() dto: CreatePaymentDto,
    @Req() request: Request & { user: { sub: string } },
  ) {
    const context = await sendRpc<{ amount: number }>(
      this.checkout,
      { cmd: 'checkout.payment-context' },
      {
        orderId: dto.salesOrderId,
        customerId: request.user.sub,
      },
    );
    if (dto.amount !== context.amount)
      throw new BadRequestException('To‘lov summasi buyurtmaga mos emas');
    return sendRpc<PaymentResultDto>(
      this.payment,
      { cmd: 'payment.create' },
      {
        ...dto,
        amount: context.amount,
        returnUrl: this.returnUrl(dto.returnUrl),
      },
    );
  }

  /**
   * `returnUrl` provayder sahifasidan brauzerni qaytaradi — ya'ni ochiq
   * redirect vektori. Shu bois faqat CORS_ORIGINS da e'lon qilingan frontend
   * origin'lariga ruxsat. CORS_ORIGINS bo'sh bo'lsa (lokal ishlab chiqish)
   * tekshiruv o'tkazib yuboriladi.
   */
  private returnUrl(candidate?: string): string | undefined {
    if (!candidate) return undefined;
    const allowed = this.config
      .get<string>('CORS_ORIGINS', '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (!allowed.length) return candidate;
    let origin: string;
    try {
      origin = new URL(candidate).origin;
    } catch {
      throw new BadRequestException('returnUrl formati noto‘g‘ri');
    }
    if (!allowed.includes(origin))
      throw new BadRequestException('returnUrl ruxsat etilgan domenda emas');
    return candidate;
  }

  @ProviderCallback()
  @Post('payments/payme/callback')
  @ApiOperation({ summary: 'Payme Merchant API JSON-RPC callback' })
  async paymeCallback(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const result = await sendRpc(
      this.payment,
      { cmd: 'payment.payme.callback' },
      { authorization, body },
    );
    return response.status(200).json(result);
  }

  @ProviderCallback()
  @Post('payments/click/prepare')
  @ApiOperation({ summary: 'Click Merchant API Prepare callback' })
  async clickPrepare(
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const result = await sendRpc(
      this.payment,
      { cmd: 'payment.click.prepare' },
      { body },
    );
    return response.status(200).json(result);
  }

  @ProviderCallback()
  @Post('payments/click/complete')
  @ApiOperation({ summary: 'Click Merchant API Complete callback' })
  async clickComplete(
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const result = await sendRpc(
      this.payment,
      { cmd: 'payment.click.complete' },
      { body },
    );
    return response.status(200).json(result);
  }

  @Put('admin/payments/providers/:provider')
  @Roles(Role.SUPERADMIN)
  @ApiOperation({ summary: 'To‘lov provayderi konfiguratsiyasini saqlash' })
  upsertProviderConfig(
    @Param('provider', new ParseEnumPipe(PaymentProvider))
    provider: PaymentProvider,
    @Body() dto: UpsertProviderConfigDto,
  ) {
    return sendRpc(
      this.payment,
      { cmd: 'payment.provider-config.upsert' },
      { provider, dto },
    );
  }

  @Get('admin/payments/providers/:provider')
  @Roles(Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Provayder sozlanganligini tekshirish (maxfiy kalitsiz)',
  })
  providerStatus(
    @Param('provider', new ParseEnumPipe(PaymentProvider))
    provider: PaymentProvider,
  ) {
    return sendRpc(
      this.payment,
      { cmd: 'payment.provider-config.status' },
      { provider },
    );
  }
}
