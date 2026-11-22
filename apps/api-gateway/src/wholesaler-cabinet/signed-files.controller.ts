import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Res,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiForbiddenResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  AFFILIATE_AUTH_RPC,
  IgnoreAuthCookie,
  LegalDocumentDto,
  LegalDocumentType,
  Public,
  RmqClient,
  sendRpc,
  WHOLESALER_CABINET_RPC as RPC,
  WholesalerDocumentRecord,
  WholesalerProfileDto,
} from '@app/common';
import { labelPdf } from '../orders/label-pdf';
import { SIGNED_FILES_PATH, SignedLinkService } from './signed-link';

/**
 * BE-30 (TC4): yopiq hujjat faqat imzolangan havola bilan — imzosiz, buzilgan yoki muddati o‘tgan havola — 403.
 * Kirish talab qilinmaydi (havolaning o‘zi ruxsat), shuning uchun keshlanmaydi va boshqa saytga yuborilmaydi.
 */
@ApiTags('files')
@Controller(SIGNED_FILES_PATH)
export class SignedFilesController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.FILE) private readonly files: ClientProxy,
    private readonly links: SignedLinkService,
  ) {}

  @Public()
  @IgnoreAuthCookie()
  @Get(':token')
  @ApiOperation({ summary: 'Yopiq hujjat (imzolangan havola, 10 daqiqa)' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiForbiddenResponse({
    description: 'Imzosiz, buzilgan yoki muddati o‘tgan havola',
  })
  async get(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const target = this.links.verify(token);
    if (!target)
      throw new ForbiddenException('Havola imzosiz yoki muddati o‘tgan');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (target.t === 'contract') {
      const wholesaler = await sendRpc<WholesalerProfileDto>(
        this.catalog,
        { cmd: 'catalog.wholesaler.admin-get' },
        { id: target.w },
      );
      if (!wholesaler.contractVersion)
        throw new ForbiddenException('Elektron shartnoma yo‘q');
      // optovik qabul qilgan versiya matni (keyin yangi versiya e’lon qilingan bo‘lsa ham)
      const contract = await sendRpc<LegalDocumentDto>(
        this.identity,
        { cmd: AFFILIATE_AUTH_RPC.LEGAL_GET },
        {
          type: LegalDocumentType.WHOLESALER_CONTRACT,
          version: wholesaler.contractVersion,
        },
      );
      return labelPdf(
        res,
        await sendRpc(
          this.catalog,
          { cmd: RPC.CONTRACT_PDF },
          { wholesalerId: target.w, contract },
        ),
      );
    }
    const doc = await sendRpc<WholesalerDocumentRecord>(
      this.catalog,
      { cmd: RPC.DOCUMENT_GET },
      { id: target.id },
    );
    const file = await sendRpc<{ contentType: string; base64: string }>(
      this.files,
      { cmd: RPC.PRIVATE_GET },
      { objectKey: doc.objectKey },
    );
    return labelPdf(res, {
      fileName: safeFileName(doc.fileName),
      contentType: file.contentType,
      base64: file.base64,
    });
  }
}

/** Content-Disposition uchun — faqat ASCII xavfsiz belgilar. */
export function safeFileName(name: string): string {
  return (
    String(name ?? '')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'hujjat'
  );
}
