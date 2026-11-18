import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RpcHttpExceptionFilter, VariantReportQueryDto } from '@app/common';
import { VariantReportService } from './variant-report.service';

/** BE-39 RPC lari: S1 va S3 sinovi hisoboti (faqat admin — gateway). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class VariantReportController {
  constructor(private readonly reports: VariantReportService) {}

  @MessagePattern({ cmd: 'lead.report.variant' })
  report(@Payload() input: { query: VariantReportQueryDto }) {
    return this.reports.report(input?.query);
  }

  @MessagePattern({ cmd: 'lead.report.variant-csv' })
  csv(@Payload() input: { query: VariantReportQueryDto }) {
    return this.reports.csv(input?.query);
  }
}
