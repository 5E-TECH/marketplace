import { StreamableFile } from '@nestjs/common';
import { of } from 'rxjs';
import { IS_PUBLIC_KEY, LegalDocumentType } from '@app/common';
import { LegalDocumentsController } from './legal-documents.controller';

describe('BE-25 6-tur: hujjat PDF i (gateway)', () => {
  it('kirishsiz ochiq; fayl sifatida yuklanadi, eski versiya keshda qolmaydi', async () => {
    const send = jest.fn(() =>
      of({
        fileName: 'sotuvchi-ofertasi-1.1.pdf',
        contentType: 'application/pdf',
        base64: Buffer.from('%PDF-1.7').toString('base64'),
      }),
    );
    const c = new LegalDocumentsController({ send } as never);
    const headers: Record<string, string> = {};
    const file = await c.pdf(LegalDocumentType.AFFILIATE_OFFER, {
      setHeader: (k: string, v: string) => (headers[k] = v),
    } as never);
    expect(send).toHaveBeenCalledWith(
      { cmd: 'identity.legal.pdf' },
      { type: 'affiliate-offer' },
    );
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders()).toMatchObject({
      type: 'application/pdf',
      disposition: 'attachment; filename="sotuvchi-ofertasi-1.1.pdf"',
    });
    expect(headers['Cache-Control']).toBe('no-cache');
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        LegalDocumentsController.prototype.pdf,
      ),
    ).toBe(true);
  });
});
