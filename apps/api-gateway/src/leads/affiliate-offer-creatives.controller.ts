import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Req,
  Res,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  AffiliateOfferDetailDto,
  CREATIVE_RPC,
  CreativeFilesResult,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';
import { CreativeArchiveService } from './creative-archive.service';
import { ParseLeadIdPipe } from './lead-id.pipe';
import { zipFits, zipLength, zipStream } from './store-zip';

/** Fayl nomi: slug ASCII (`[a-z0-9-]`), boshqa belgi — `-`. */
const asciiName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, '-');

/**
 * BE-25 (FE-05, `docs/api-taklif/fe-05-sotuvchi-offer.md`): sotuvchi offerning kreativlarini bitta ZIP da yuklaydi
 * (dizayn p-s2 «Hammasini yuklab olish»). Offer sotuvchiga ko‘rinmasa — 404 (offer kartasi bilan bir xil).
 */
@ApiTags('affiliate')
@ApiBearerAuth()
@Roles(Role.AFFILIATE)
@Controller('affiliate/offers')
export class AffiliateOfferCreativesController {
  private readonly logger = new Logger(AffiliateOfferCreativesController.name);

  constructor(
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    private readonly archive: CreativeArchiveService,
  ) {}

  @Get(':productId/creatives/archive')
  // video 100 MB gacha — so‘rovlar soni cheklanadi [taklif]
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Offer kreativlari bitta ZIP da',
    description:
      'Offer kartasidagi kreativlar (`GET /affiliate/offers/:productId` `creatives`) tartib bilan, siqmasdan: ' +
      '`01-video.mp4`, `02-rasm.jpg` [taklif]. Fayl nomi `<slug>-kreativlar.zip` [taklif]. Offer yopiq yoki ' +
      'kreativi yo‘q — 404. Hajm katta bo‘lishi mumkin (video 100 MB gacha, 20 tagacha) — frontend kutish vaqtini ' +
      'shunga qarab qo‘ysin.',
  })
  @ApiProduces('application/zip')
  @ApiOkResponse({
    description: 'ZIP arxiv (`Content-Disposition: attachment`)',
    content: {
      'application/zip': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiNotFoundResponse({ description: 'Offer topilmadi yoki kreativi yo‘q' })
  @ApiServiceUnavailableResponse({ description: 'Kreativ fayllari o‘qilmadi' })
  async download(
    @Param('productId', ParseLeadIdPipe) productId: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<StreamableFile> {
    const offer = await sendRpc<AffiliateOfferDetailDto>(
      this.lead,
      { cmd: 'lead.offer.get-affiliate' },
      { productId },
    );
    const visible = new Set((offer?.creatives ?? []).map((c) => String(c.id)));
    const { slug, files } = await sendRpc<CreativeFilesResult>(
      this.catalog,
      { cmd: CREATIVE_RPC.FILES },
      { productId },
    );
    // faqat offerda ko‘rinadiganlari va shu mahsulot papkasidagilar
    const chosen = files.filter(
      (f) =>
        visible.has(String(f.id)) &&
        f.objectKey.startsWith(`creatives/${productId}/`),
    );
    if (!chosen.length) throw new NotFoundException('Offerda kreativ yo‘q');
    const entries = await this.archive.entries(chosen);
    if (!zipFits(entries))
      throw new UnprocessableEntityException(
        'Kreativlar bitta arxivga sig‘maydi — alohida yuklab oling',
      );
    const name = `${slug || `offer-${productId}`}-kreativlar.zip`;
    const headers = {
      type: 'application/zip',
      disposition: `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      length: zipLength(entries),
    };
    // HEAD — faqat sarlavhalar: arxiv o‘qilmaydi
    if (req?.method === 'HEAD')
      return new StreamableFile(Buffer.alloc(0), headers);
    const stream = zipStream(entries);
    // mijoz uzilsa yoki vaqt tugasa — arxiv va MinIO oqimi yopiladi
    res?.once('close', () => {
      if (!res.writableFinished) stream.destroy();
    });
    const file = new StreamableFile(stream, headers);
    // sarlavha ketgandan keyingi xato — ulanish uziladi (yarim fayl to‘liq bo‘lib ko‘rinmasin)
    file.setErrorHandler((error, res) => {
      this.logger.error(
        `Kreativlar arxivi (${productId}) uzildi: ${error?.message}`,
      );
      const response = res as typeof res & { destroy?: () => void };
      if (res.destroyed) return;
      if (res.headersSent && response.destroy) response.destroy();
      else {
        res.statusCode = 503;
        res.send('Kreativ fayllari o‘qilmadi');
      }
    });
    return file;
  }
}
