import {
  InboundShipmentDto,
  InboundShipmentStatus,
  ReturnInspectionDto,
} from '@app/common';
import { inspectPdf } from '@app/common/pdf/pdf-inspect';
import { ClientProxy } from '@nestjs/microservices';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import { InboundService } from './inbound.service';
import { ReturnInspectionService } from './return-inspection.service';

/** Qabul va brak aktlari kirill va ʻ/ʼ bilan — Unicode shrift (DejaVu), Helvetica yo‘q. */
describe('Ombor aktlari PDF — Unicode shrift', () => {
  const catalog = (reply: unknown) =>
    ({ send: jest.fn(() => of(reply)) }) as unknown as ClientProxy;
  const read = (base64: string) => {
    const pdf = Buffer.from(base64, 'base64');
    expect(pdf.toString('latin1')).not.toContain('Helvetica');
    return inspectPdf(pdf);
  };
  const dejavu = [
    expect.stringMatching(/^[A-Z]{6}\+DejaVuSansCondensed$/),
    expect.stringMatching(/^[A-Z]{6}\+DejaVuSansCondensed-Bold$/),
  ];

  it('qabul akti: optovik va mahsulot nomi kirillda, ʻ/ʼ o‘z holicha', async () => {
    const service = new InboundService(
      {} as DataSource,
      catalog({
        name: 'ООО «Ромашка Савдо»',
        tin: '301234567',
        contractNumber: 'K-12',
        contractDate: '2026-11-01',
      }),
    );
    jest.spyOn(service, 'get').mockResolvedValue({
      id: '3',
      number: 'PST-000003',
      wholesalerId: '501',
      status: InboundShipmentStatus.DISCREPANCY,
      expectedAt: '2026-11-25',
      receivedAt: '2026-11-25T05:30:00.000Z',
      receivedBy: '12',
      receiveComment: 'Qutining biri gʻijimlangan, maʼlumot optovikka berildi',
      items: [
        {
          productName: 'Витамин С 1000 мг',
          sku: 'VIT-C-60',
          barcode: '4780000000017',
          cell: 'A-01-02',
          batch: 'L-77',
          expiryDate: '2027-06-30',
          declaredQty: 100,
          receivedQty: 98,
          defectiveQty: 2,
        },
      ],
    } as unknown as InboundShipmentDto);

    const act = await service.actPdf({ id: '3' });
    const { text, fonts } = read(act.base64);

    expect(fonts).toHaveLength(2);
    expect(fonts).toEqual(expect.arrayContaining(dejavu));
    expect(text).toContain('Qabul akti (farq va brak) No PST-000003');
    expect(text).toContain(
      'Komitent (optovik): ООО «Ромашка Савдо», STIR 301234567',
    );
    expect(text).toContain(
      '1.  Витамин С 1000 мг | VIT-C-60 / 4780000000017 | A-01-02 | L-77 | 2027-06-30 | 100 | 98 | 2 | -2',
    );
    expect(text).toContain(
      'Ombor izohi: Qutining biri gʻijimlangan, maʼlumot optovikka berildi',
    );
  });

  it('brak akti: mahsulot nomi kirillda, izohda ʻ', async () => {
    const service = new ReturnInspectionService(
      {} as DataSource,
      catalog([
        { variantId: '77', productName: 'Шампунь «Олма»', sku: 'SH-01' },
      ]),
    );
    jest.spyOn(service, 'get').mockResolvedValue({
      orderId: '7101',
      inspectedBy: '12',
      inspectedAt: '2026-11-25T05:30:00.000Z',
      comment: 'Qopqogʻi singan',
      items: [{ variantId: '77', sellable: 0, defective: 1 }],
    } as unknown as ReturnInspectionDto);

    const act = await service.defectActPdf({
      orderRef: '7101',
      shipmentId: '1251177',
    });
    const { text, fonts } = read(act.base64);

    expect(fonts).toHaveLength(2);
    expect(fonts).toEqual(expect.arrayContaining(dejavu));
    expect(text).toContain('Brak akti — buyurtma 7101');
    expect(text).toContain('1.  Шампунь «Олма» | SH-01 | 1 | Brak');
    expect(text).toContain('Izoh: Qopqogʻi singan');
  });
});
