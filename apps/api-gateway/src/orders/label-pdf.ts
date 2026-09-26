import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

/** checkout-service yorliq RPC javobi (C1.45). */
export interface LabelDocument {
  fileName: string;
  contentType: string;
  base64: string;
  skipped?: Array<{ orderId: string; sellerOrderId?: string; reason: string }>;
}

export const LABELS_SKIPPED_HEADER = 'X-Labels-Skipped';

/**
 * PDF javobi. Partiyada chiqmay qolgan yorliqlar tanaga sig'maydi (tana —
 * PDF), shuning uchun header'da: sabablar o'zbekcha (`‘` kabi ASCII bo'lmagan
 * belgilar), header esa faqat ASCII — URI-encoded JSON.
 */
export function labelPdf(res: Response, document: LabelDocument) {
  if (document.skipped?.length) {
    res.setHeader(
      LABELS_SKIPPED_HEADER,
      encodeURIComponent(JSON.stringify(document.skipped)),
    );
  }
  const buffer = Buffer.from(document.base64, 'base64');
  return new StreamableFile(buffer, {
    type: document.contentType,
    disposition: `attachment; filename="${document.fileName}"`,
    length: buffer.length,
  });
}
