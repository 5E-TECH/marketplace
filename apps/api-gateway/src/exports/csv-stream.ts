import { StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';

/** Servis bir bo‘lakda qaytaradigan CSV qatorlari; `nextAfterId` bo‘sh — tugadi. */
export interface CsvChunk {
  lines: string[];
  nextAfterId: string | null;
}

/**
 * CSV oqimi (UTF-8 BOM, «;»). Birinchi bo‘lak oqimdan oldin olinadi — xato bo‘lsa javob 200 emas, xato bo‘ladi; keyingi
 * bo‘lakda xato bo‘lsa oqim uziladi (chala fayl to‘liq bo‘lib ko‘rinmaydi).
 */
export async function csvStream(
  fileName: string,
  chunk: (afterId: string | null) => Promise<CsvChunk>,
): Promise<StreamableFile> {
  const first = await chunk(null);
  async function* lines(): AsyncGenerator<string> {
    yield '﻿';
    let current = first;
    for (;;) {
      if (current.lines.length) yield `${current.lines.join('\r\n')}\r\n`;
      if (!current.nextAfterId) return;
      current = await chunk(current.nextAfterId);
    }
  }
  return new StreamableFile(Readable.from(lines(), { objectMode: false }), {
    type: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${fileName}"`,
  });
}
