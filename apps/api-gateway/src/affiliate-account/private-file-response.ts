import { StreamableFile } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import type { Response } from 'express';
import {
  AffiliateDocumentFile,
  sendRpc,
  WHOLESALER_CABINET_RPC,
} from '@app/common';

/**
 * Yopiq ma’lumotnoma brauzerda ochiladi (inline): keshlanmaydi, turi taxmin qilinmaydi, skript ishlamaydi.
 * Kirish huquqi (egasi yoki tekshiruvchi) chaqiruvchida tekshirilgan bo‘ladi.
 */
export async function sendPrivateFile(
  files: ClientProxy,
  res: Response,
  document: AffiliateDocumentFile,
): Promise<StreamableFile> {
  const file = await sendRpc<{ contentType: string; base64: string }>(
    files,
    { cmd: WHOLESALER_CABINET_RPC.PRIVATE_GET },
    { objectKey: document.objectKey },
  );
  const body = Buffer.from(file.base64, 'base64');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  return new StreamableFile(body, {
    type: file.contentType,
    disposition: `inline; filename*=UTF-8''${encodeFileName(document.fileName)}`,
    length: body.length,
  });
}

/** RFC 5987: header faqat ASCII. */
function encodeFileName(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
