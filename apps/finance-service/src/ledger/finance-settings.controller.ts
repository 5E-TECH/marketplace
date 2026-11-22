import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  FINANCE_SETTINGS_RPC,
  FinanceSettingCancelInput,
  FinanceSettingSetInput,
  RpcHttpExceptionFilter,
} from '@app/common';
import { FinanceSettingsService } from './finance-settings.service';

/** BE-27 (ADM-2): moliya sozlamalari — gateway `admin/finance/settings`. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class FinanceSettingsController {
  constructor(private readonly settings: FinanceSettingsService) {}

  @MessagePattern({ cmd: FINANCE_SETTINGS_RPC.LIST })
  list() {
    return this.settings.list();
  }

  @MessagePattern({ cmd: FINANCE_SETTINGS_RPC.SET })
  set(@Payload() data: FinanceSettingSetInput) {
    return this.settings.set(data);
  }

  @MessagePattern({ cmd: FINANCE_SETTINGS_RPC.CANCEL })
  cancel(@Payload() data: FinanceSettingCancelInput) {
    return this.settings.cancelScheduled(data);
  }
}
