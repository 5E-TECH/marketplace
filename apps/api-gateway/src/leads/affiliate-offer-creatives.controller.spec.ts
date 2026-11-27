import { EventEmitter } from 'events';
import { PassThrough, Readable } from 'stream';
import { of, throwError } from 'rxjs';
import { CREATIVE_RPC, CreativeType, ROLES_KEY, Role } from '@app/common';
import { AffiliateOfferCreativesController } from './affiliate-offer-creatives.controller';
import { CreativeArchiveService } from './creative-archive.service';

/** BE-25 (FE-05): offer kreativlari ZIP — ko‘rinish lead dan, fayllar catalog dan, baytlar MinIO dan. */
describe('AffiliateOfferCreativesController', () => {
  const files = [
    {
      id: '31',
      type: CreativeType.VIDEO,
      objectKey: 'creatives/12/a.mp4',
      mimeType: 'video/mp4',
      size: 5,
      position: 0,
    },
    {
      id: '32',
      type: CreativeType.IMAGE,
      objectKey: 'creatives/12/b.JPG',
      mimeType: 'image/jpeg',
      size: 3,
      position: 1,
    },
    // offerda ko‘rinmaydi (masalan, yangi qo‘shilgan, offer keshi eski)
    {
      id: '33',
      type: CreativeType.IMAGE,
      objectKey: 'creatives/12/c.png',
      mimeType: 'image/png',
      size: 1,
      position: 2,
    },
    // boshqa mahsulot papkasi — hech qachon arxivga tushmaydi
    {
      id: '34',
      type: CreativeType.IMAGE,
      objectKey: 'creatives/99/d.png',
      mimeType: 'image/png',
      size: 1,
      position: 3,
    },
  ];
  const setup = (offer: unknown, slug: string | null = 'simsiz-quloqchin') => {
    const lead = {
      send: jest.fn(() =>
        offer instanceof Error ? throwError(() => offer) : of(offer),
      ),
    };
    const catalog = { send: jest.fn(() => of({ slug, files })) };
    const minio = {
      statObject: jest.fn(async (_bucket: string, key: string) => ({
        size: key.endsWith('.mp4') ? 5 : 3,
      })),
      getObject: jest.fn(async (_bucket: string, key: string) =>
        Readable.from([Buffer.from(key.endsWith('.mp4') ? 'video' : 'jpg')]),
      ),
    };
    const archive = new CreativeArchiveService({
      get: (key: string, fallback?: unknown) =>
        key === 'MINIO_BUCKET' ? 'media' : fallback,
      getOrThrow: () => 'x',
    } as never);
    (archive as unknown as { client: unknown }).client = minio;
    return {
      controller: new AffiliateOfferCreativesController(
        lead as never,
        catalog as never,
        archive,
      ),
      lead,
      catalog,
      minio,
    };
  };
  const offer = {
    productId: '12',
    creatives: [
      { id: '31', type: 'VIDEO' },
      { id: '32', type: 'IMAGE' },
      { id: '34', type: 'IMAGE' },
    ],
  };

  it('faqat sotuvchi (AFFILIATE)', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AffiliateOfferCreativesController),
    ).toEqual([Role.AFFILIATE]);
  });

  it('ZIP: offerda ko‘rinadigan va shu mahsulot papkasidagi fayllar, tartib bilan; nom slug bilan; uzunlik aniq', async () => {
    const { controller, lead, catalog, minio } = setup(offer);
    const file = await controller.download('12');
    const headers = file.getHeaders();
    expect(headers.type).toBe('application/zip');
    expect(headers.disposition).toBe(
      'attachment; filename="simsiz-quloqchin-kreativlar.zip"; filename*=UTF-8\'\'simsiz-quloqchin-kreativlar.zip',
    );
    const chunks: Buffer[] = [];
    for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk));
    const zip = Buffer.concat(chunks);
    expect(zip.length).toBe(headers.length);
    const text = zip.toString('latin1');
    expect(text).toContain('01-video.mp4');
    expect(text).toContain('02-rasm.jpg');
    expect(text).not.toContain('c.png');
    expect(minio.getObject.mock.calls.map((c) => c[1])).toEqual([
      'creatives/12/a.mp4',
      'creatives/12/b.JPG',
    ]);
    expect(lead.send).toHaveBeenCalledWith(
      { cmd: 'lead.offer.get-affiliate' },
      { productId: '12' },
    );
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: CREATIVE_RPC.FILES },
      { productId: '12' },
    );
  });

  it('slug yo‘q — `offer-<id>-kreativlar.zip`', async () => {
    const { controller } = setup(offer, null);
    expect(
      (await controller.download('12')).getHeaders().disposition,
    ).toContain('filename="offer-12-kreativlar.zip"');
  });

  it('offer yopiq — lead 404 o‘tadi (catalog va MinIO so‘ralmaydi)', async () => {
    const { controller, catalog, minio } = setup(
      Object.assign(new Error('Offer topilmadi'), { status: 404 }),
    );
    await expect(controller.download('12')).rejects.toMatchObject({
      status: 404,
    });
    expect(catalog.send).not.toHaveBeenCalled();
    expect(minio.statObject).not.toHaveBeenCalled();
  });

  it('offerda kreativ yo‘q — 404', async () => {
    const { controller } = setup({ productId: '12', creatives: [] });
    await expect(controller.download('12')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('fayl MinIO da o‘qilmasa — javob boshlanmasdan 503', async () => {
    const { controller, minio } = setup(offer);
    minio.statObject.mockRejectedValueOnce(new Error('NoSuchKey'));
    await expect(controller.download('12')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('HEAD — faqat sarlavhalar (uzunlik bilan), MinIO dan fayl o‘qilmaydi', async () => {
    const { controller, minio } = setup(offer);
    const file = await controller.download('12', { method: 'HEAD' } as never);
    expect(file.getHeaders().length).toBeGreaterThan(0);
    expect(minio.getObject).not.toHaveBeenCalled();
  });

  it('mijoz uzilsa — arxiv oqimi va o‘qilayotgan fayl yopiladi', async () => {
    const { controller, minio } = setup(offer);
    const source = new PassThrough();
    minio.getObject.mockResolvedValueOnce(source as never);
    const res = new EventEmitter() as EventEmitter & {
      writableFinished: boolean;
    };
    res.writableFinished = false;
    const file = await controller.download(
      '12',
      { method: 'GET' } as never,
      res as never,
    );
    const stream = file.getStream();
    // birinchi bo‘lak (sarlavha) o‘qiladi, keyin fayl kutiladi
    stream.on('data', () => undefined);
    stream.on('error', () => undefined);
    await new Promise((r) => setTimeout(r, 10));
    expect(minio.getObject).toHaveBeenCalled();
    res.emit('close');
    await new Promise((r) => setTimeout(r, 10));
    expect(stream.destroyed).toBe(true);
    expect(source.destroyed).toBe(true);
  });
});
