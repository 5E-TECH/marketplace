import {
  Body,
  Controller,
  Inject,
  Param,
  ParseEnumPipe,
  Post,
  Put,
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
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UpsertProviderConfigDto,
} from '@app/common';

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
