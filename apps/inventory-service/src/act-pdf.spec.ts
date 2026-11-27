import {
  InboundShipmentDto,
  InboundShipmentStatus,
  ReturnInspectionDto,
  UserNamesClient,
} from '@app/common';
import { inspectPdf } from '@app/common/pdf/pdf-inspect';
import { ClientProxy } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
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
  const names = (fail = false) =>
    new UserNamesClient({
      send: jest.fn(() =>
        fail
          ? throwError(() => new Error('identity yo‘q'))
          : of([{ id: '12', name: 'Jasur Toshmatov', role: 'WAREHOUSE' }]),
      ),
    } as never);
  const dejavu = [
    expect.stringMatching(/^[A-Z]{6}\+DejaVuSansCondensed$/),
    expect.stringMatching(/^[A-Z]{6}\+DejaVuSansCondensed-Bold$/),
  ];

  const shipment = (
    over: Partial<InboundShipmentDto> = {},
    item: Record<string, unknown> = {},
  ) =>
    ({
      id: '3',
      number: 'PST-000003',
      wholesalerId: '501',
      status: InboundShipmentStatus.DISCREPANCY,
      expectedAt: '2026-11-25',
      receivedAt: '2026-11-25T05:30:00.000Z',
      receivedBy: '12',
      receiveComment: null,
      items: [
        {
          productName: 'Choynak',
          sku: 'CH-01',
          barcode: null,
          cell: 'B-08',
          batch: null,
          expiryDate: null,
          declaredQty: 10,
          receivedQty: 9,
          defectiveQty: 0,
          ...item,
        },
      ],
      ...over,
    }) as unknown as InboundShipmentDto;
  const inbound = (fail = false) =>
    new InboundService(
      {} as DataSource,
      catalog({
        name: 'Optovik MCHJ',
        tin: '301234567',
        contractNumber: 'K-12',
        contractDate: '2026-11-01',
      }),
      undefined,
      names(fail),
    );

  it('qabul akti: optovik va mahsulot nomi kirillda, ʻ/ʼ o‘z holicha; qabul — yaroqlisi (TC1: 100 keldi, 2 brak)', async () => {
    const service = new InboundService(
      {} as DataSource,
      catalog({
        name: 'ООО «Ромашка Савдо»',
        tin: '301234567',
        contractNumber: 'K-12',
        contractDate: '2026-11-01',
      }),
      undefined,
      names(),
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
          receivedQty: 100,
          defectiveQty: 2,
        },
      ],
    } as unknown as InboundShipmentDto);

    const act = await service.actPdf({ id: '3' });
    const { text, fonts } = read(act.base64);

    expect(fonts).toHaveLength(2);
    expect(fonts).toEqual(expect.arrayContaining(dejavu));
    expect(text).toContain('Postavka qabul akti No PST-000003');
    expect(text).toContain('FARQ BOR · farq akti');
    expect(text).toContain(
      'Komitent (optovik): ООО «Ромашка Савдо», STIR 301234567',
    );
    expect(text).toContain('Asos: komissiya shartnomasi № K-12, 01.11.2026');
    expect(text).toContain(
      'Postavka arizasi: PST-000003 · Kelish sanasi: 25.11.2026',
    );
    expect(text).toContain(
      'Qabul yakunlandi: 2026-11-25 10:30 · Qabul qildi: Jasur T., omborchi',
    );
    expect(text).toContain(
      '1.  Витамин С 1000 мг | VIT-C-60 / 4780000000017 | A-01-02 | L-77 | 2027-06-30 | 100 | 98 | 2 | −2',
    );
    expect(text).toContain('Jami: e’lon 100, qabul 98, brak 2, farq −2');
    expect(text).toContain('Farq: −2 dona — hammasi brak');
    expect(text).toContain('Sanaldi: 100 / 100 · kam kelgan tovar yo‘q');
    expect(text).toContain('Qoldiqqa kirdi: 98 dona — sotuvga chiqdi.');
    expect(text).toContain(
      'Brak: 2 dona — qoldiqqa kirmaydi. Brak tovar uchun pul yozilmaydi.',
    );
    expect(text).toContain(
      'Ombor izohi: Qutining biri gʻijimlangan, maʼlumot optovikka berildi',
    );
    expect(text).toContain(
      'Qabul qildi — ombor: Jasur T., omborchi   ________________   Muhr o‘rni',
    );
    expect(text).toContain('Postavka qabul akti PST-000003 · 1 / 1 bet');
    expect(text).toContain('Tuzildi 2026-11-25 10:30 · Jasur T.');
    expect(text).not.toContain('#12');
  });

  it('qabul akti: kam kelgan tovar — farq va «kam kelgan»; identity javob bermasa `#ID` (PDF yiqilmaydi)', async () => {
    const service = inbound(true);
    jest.spyOn(service, 'get').mockResolvedValue(shipment());
    const { text } = read((await service.actPdf({ id: '3' })).base64);
    expect(text).toContain('| 10 | 9 | 0 | −1');
    expect(text).toContain('Farq: −1 dona — 1 kam kelgan');
    expect(text).toContain('Sanaldi: 9 / 10 · kam kelgan 1');
    expect(text).toContain('Qabul qildi: #12');
    expect(text).not.toContain('Brak:');
  });

  it('qabul akti: farqsiz — «FARQSIZ», «Farq yo‘q»; muddatiga 60 kundan kam partiya sotuvga chiqmaydi', async () => {
    const service = inbound();
    jest
      .spyOn(service, 'get')
      .mockResolvedValue(
        shipment(
          { status: InboundShipmentStatus.RECEIVED },
          { declaredQty: 20, receivedQty: 20, expiryDate: '2027-01-12' },
        ),
      );
    const { text } = read((await service.actPdf({ id: '3' })).base64);
    expect(text).toContain('FARQSIZ');
    expect(text).toContain('Farq yo‘q: 20 / 20 dona');
    expect(text).toContain('Brak yo‘q · kam kelgan tovar yo‘q');
    expect(text).toContain(
      'Qoldiqqa kirdi: 20 dona — shundan 20 dona sotuvga chiqmaydi (muddatiga 60 kundan kam).',
    );
  });

  it('brak akti: mahsulot nomi kirillda, izohda ʻ', async () => {
    const service = new ReturnInspectionService(
      {} as DataSource,
      catalog([
        { variantId: '77', productName: 'Шампунь «Олма»', sku: 'SH-01' },
      ]),
      names(),
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
    expect(text).toContain(
      'Saralandi: 2026-11-25 10:30 · Saralagan: Jasur T., omborchi',
    );
    expect(text).toContain('Brak akti 7101 · 1 / 1 bet');
    expect(text).not.toContain('#12');
  });
});
