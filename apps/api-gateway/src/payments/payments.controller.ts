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
    return sendRpc(
      this.payment,
      { cmd: 'payment.create' },
      { ...dto, amount: context.amount },
    );
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
