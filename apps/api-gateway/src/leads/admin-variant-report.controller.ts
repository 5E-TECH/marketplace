import {
  Controller,
  Get,
  Inject,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  RmqClient,
  Role,
  Roles,
  sendRpc,
  VariantReportDto,
  VariantReportQueryDto,
} from '@app/common';

/**
 * S1 va S3 sinovi hisoboti (BE-39; LID-8, `sinov-s1-s3.md`). Faqat ADMIN va SUPERADMIN (T02:180: eksport faqat
 * admin); operator va sotuvchi variantni ko‘rmaydi. Alohida ekran yo‘q — JSON yoki CSV.
 */
@ApiTags('admin-reports')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/reports/s1-s3')
export class AdminVariantReportController {
  constructor(@Inject(RmqClient.LEAD) private readonly lead: ClientProxy) {}

  @Get()
  @ApiOperation({
    summary:
      'S1 va S3: variant va mahsulot kesimida tashrifdan qabul qilingan posilkagacha',
    description:
      'Hal qiluvchi raqam — 1000 tashrifga tushgan pul. Variantsiz lidlar kirmaydi; dublikat birinchi arizaning variantida. Sinov natijaga qarab erta to‘xtatilmaydi.',
  })
  @ApiOkResponse({ type: VariantReportDto })
  report(@Query() query: VariantReportQueryDto): Promise<VariantReportDto> {
    return sendRpc(this.lead, { cmd: 'lead.report.variant' }, { query });
  }

  @Get('csv')
  @ApiOperation({ summary: 'Xuddi shu hisobot CSV da (UTF-8, «;»)' })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description:
      'CSV fayl (UTF-8 BOM, «;»): `s1-s3-sinov_<from>_<to>.csv`, qatorlari JSON hisobotdagi `rows` bilan bir xil',
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  })
  async csv(
    @Query() query: VariantReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await sendRpc<{ fileName: string; content: string }>(
      this.lead,
      { cmd: 'lead.report.variant-csv' },
      { query },
    );
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
    });
    return new StreamableFile(Buffer.from(file.content, 'utf8'));
  }
}
