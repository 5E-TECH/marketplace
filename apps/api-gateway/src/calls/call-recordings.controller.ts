import {
  BadGatewayException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  CALL_RPC,
  CallErrorCode,
  IgnoreAuthCookie,
  Public,
  RecordingMode,
  RmqClient,
  sendRpc,
} from '@app/common';
import { RecordingLinkService, RECORDINGS_PATH } from './recording-link';

/** Provayder sarlavhalarini kutish (audio oqimi cheklanmaydi). */
const PROVIDER_TIMEOUT_MS = 10_000;
const RANGE = /^bytes=\d*-\d*$/;

/**
 * BE-15 (TEL-6, TEL-7): yozuvni provayderdan oqim bilan uzatish. Faqat imzolangan vaqtli havola bilan; provayder manzili
 * va kaliti brauzerga chiqmaydi, yo‘l — sozlamadagi provayder va bazadagi yozuv kaliti (foydalanuvchi URL bermaydi).
 */
@ApiTags('calls')
@Controller(RECORDINGS_PATH)
export class CallRecordingsController {
  private readonly logger = new Logger(CallRecordingsController.name);

  constructor(
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    private readonly links: RecordingLinkService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @IgnoreAuthCookie()
  @Get(':token')
  @ApiOperation({
    summary: 'Qo‘ng‘iroq yozuvi (imzolangan havola, 10 daqiqa)',
    description:
      '`Range` qo‘llab-quvvatlanadi — pleyerda oldinga o‘tish uchun.',
  })
  @ApiProduces('audio/mpeg', 'audio/ogg', 'audio/wav')
  @ApiOkResponse({
    content: {
      'audio/mpeg': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiForbiddenResponse({
    description: 'Imzosiz, buzilgan yoki muddati o‘tgan havola',
  })
  async stream(
    @Param('token') token: string,
    @Headers('range') range: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const target = this.links.verify(token);
    if (!target)
      throw new ForbiddenException('Havola imzosiz yoki muddati o‘tgan');
    const base = (this.config.get<string>('TELEPHONY_API_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    if (!base)
      throw new ServiceUnavailableException({
        message: 'Telefoniya ulanmagan',
        errorCode: CallErrorCode.TELEPHONY_NOT_CONFIGURED,
      });
    const { recordingRef } = await sendRpc<{ recordingRef: string }>(
      this.lead,
      { cmd: CALL_RPC.RECORDING_REF },
      { callId: target.callId },
    );
    const token_ = this.config.get<string>('TELEPHONY_API_TOKEN')?.trim();
    const abort = new AbortController();
    const onClose = () => abort.abort();
    req.on('close', onClose);
    const timer = setTimeout(() => abort.abort(), PROVIDER_TIMEOUT_MS);
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(
        `${base}/recordings/${encodeURIComponent(recordingRef)}`,
        {
          headers: {
            ...(token_ ? { authorization: `Bearer ${token_}` } : {}),
            ...(range && RANGE.test(range) ? { range } : {}),
          },
          redirect: 'error',
          signal: abort.signal,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Yozuv olinmadi (qo‘ng‘iroq ${target.callId}): ${(error as Error)?.message}`,
      );
      throw new BadGatewayException('Yozuv provayderdan olinmadi');
    } finally {
      clearTimeout(timer);
    }
    const type = (upstream.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (upstream.status === 404) {
      await upstream.body?.cancel();
      throw new NotFoundException({
        message:
          'Yozuv provayderda yo‘q (saqlash muddati tugagan bo‘lishi mumkin)',
        errorCode: CallErrorCode.RECORDING_NOT_READY,
      });
    }
    if (
      (upstream.status !== 200 && upstream.status !== 206) ||
      !upstream.body ||
      !type.startsWith('audio/')
    ) {
      await upstream.body?.cancel();
      this.logger.warn(
        `Yozuv javobi yaroqsiz (qo‘ng‘iroq ${target.callId}): HTTP ${upstream.status}, ${type}`,
      );
      throw new BadGatewayException('Yozuv provayderdan olinmadi');
    }
    res.status(upstream.status);
    res.setHeader('Content-Type', type);
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${target.mode === RecordingMode.DOWNLOAD ? 'attachment' : 'inline'}; filename="qongiroq-${target.callId}${EXTENSION[type] ?? ''}"`,
    );
    try {
      await pipeline(Readable.fromWeb(upstream.body as never), res);
    } catch (error) {
      // tinglovchi yopdi yoki provayder uzildi — javob allaqachon boshlangan
      this.logger.debug(`Yozuv oqimi uzildi: ${(error as Error)?.message}`);
      res.destroy();
    } finally {
      req.off('close', onClose);
    }
  }
}

const EXTENSION: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
};
