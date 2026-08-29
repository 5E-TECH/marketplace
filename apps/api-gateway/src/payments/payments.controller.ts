import {
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Res,
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
  Public,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UpsertProviderConfigDto,
} from '@app/common';
import { Response } from 'express';

@ApiTags('payments')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(
    @Inject(RmqClient.PAYMENT) private readonly payment: ClientProxy,
  ) {}

  @Post('payments')
  @ApiOperation({ summary: 'Online to‘lov yozuvini yaratish' })
  @ApiCreatedResponse({ type: PaymentResultDto })
  create(@Body() dto: CreatePaymentDto) {
    return sendRpc(this.payment, { cmd: 'payment.create' }, dto);
  }

  @Public()
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

  @Public()
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

  @Public()
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
}
