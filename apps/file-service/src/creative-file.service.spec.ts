import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { CreativeType } from '@app/common';
import { CreativeFileService } from './creative-file.service';

const minio = {
  newPostPolicy: jest.fn(),
  presignedPostPolicy: jest.fn(),
  statObject: jest.fn(),
  getPartialObject: jest.fn(),
  copyObject: jest.fn(),
  removeObject: jest.fn(),
  getBucketLifecycle: jest.fn(),
  setBucketLifecycle: jest.fn(),
};
const conditions = { setMatchETag: jest.fn() };
// jest.mock importlardan oldinga ko‘tariladi (hoist)
jest.mock('minio', () => ({
  Client: jest.fn(() => minio),
  CopyConditions: jest.fn(() => conditions),
}));

const minioError = (code: string) => Object.assign(new Error(code), { code });

describe('CreativeFileService (BE-08)', () => {
  const policy = {
    setBucket: jest.fn(),
    setKey: jest.fn(),
    setContentType: jest.fn(),
    setContentLengthRange: jest.fn(),
    setExpires: jest.fn(),
  };
  const config = {
    getOrThrow: (key: string) =>
      ({
        MINIO_ENDPOINT: 'minio',
        MINIO_PORT: 9000,
        MINIO_ACCESS_KEY: 'a',
        MINIO_SECRET_KEY: 'b',
        MINIO_BUCKET: 'marketplace-media',
        MINIO_PUBLIC_URL: 'https://api.elchi.test/media/',
      })[key],
    get: (key: string, fallback?: unknown) =>
      ({ MINIO_USE_SSL: false })[key] ?? fallback,
  };
  const make = () => new CreativeFileService(config as never);
  const MB = 1024 * 1024;
  const uuid = '7b0c3e1a-1111-4222-8333-944455556666';
  const uploadKey = `creative-uploads/12/${uuid}.png`;
  const finalKey = `creatives/12/${uuid}.png`;
  /** getPartialObject javobi kabi: baytlar va HTTP sarlavhalari (ETag qo‘shtirnoq bilan). */
  const withEtag = (stream: Readable, etag = 'e1') =>
    Object.assign(stream, { headers: { etag: `"${etag}"` } });
  const png = (etag = 'e1') =>
    withEtag(
      Readable.from([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
      ]),
      etag,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    minio.newPostPolicy.mockReturnValue(policy);
    minio.presignedPostPolicy.mockResolvedValue({
      postURL: 'http://minio:9000/marketplace-media',
      formData: { policy: 'p', 'x-amz-signature': 's' },
    });
    minio.copyObject.mockResolvedValue({});
    minio.removeObject.mockResolvedValue(undefined);
  });

  it('TC1: 80 MB mp4 — imzolangan POST: ochiq manzil, yopiq yuklash kaliti, tur va hajm oralig‘i policy da', async () => {
    const result = await make().uploadPolicy({
      productId: '12',
      type: CreativeType.VIDEO,
      contentType: 'video/mp4',
      size: 80 * MB,
    });
    expect(result.url).toBe('https://api.elchi.test/media/marketplace-media');
    expect(result.objectKey).toMatch(
      /^creative-uploads\/12\/[0-9a-f-]{36}\.mp4$/,
    );
    expect(result.fields).toEqual({ policy: 'p', 'x-amz-signature': 's' });
    expect(result.maxSize).toBe(100 * MB);
    expect(policy.setKey).toHaveBeenCalledWith(result.objectKey);
    expect(policy.setContentType).toHaveBeenCalledWith('video/mp4');
    expect(policy.setContentLengthRange).toHaveBeenCalledWith(1, 100 * MB);
    expect(policy.setBucket).toHaveBeenCalledWith('marketplace-media');
  });

  it('TC2: sozlamada yo‘q tur, rasm uchun video turi yoki chegaradan katta hajm — 400', async () => {
    const service = make();
    for (const input of [
      { type: CreativeType.VIDEO, contentType: 'video/quicktime', size: MB },
      { type: CreativeType.IMAGE, contentType: 'video/mp4', size: MB },
      { type: CreativeType.IMAGE, contentType: 'image/gif', size: MB },
      { type: CreativeType.VIDEO, contentType: 'video/mp4', size: 101 * MB },
      { type: CreativeType.IMAGE, contentType: 'image/png', size: 11 * MB },
    ])
      await expect(
        service.uploadPolicy({ productId: '12', ...input }),
      ).rejects.toBeInstanceOf(BadRequestException);
    expect(minio.presignedPostPolicy).not.toHaveBeenCalled();
  });

  it('TC3: rasm — tekshiruvdan o‘tadi, aynan tekshirilgan versiya (ETag) ochiq papkaga ko‘chadi, yuklama o‘chadi', async () => {
    minio.statObject.mockResolvedValue({
      size: 2048,
      etag: 'e1',
      metaData: { 'content-type': 'image/png' },
    });
    minio.getPartialObject.mockResolvedValue(png());
    await expect(
      make().verify({ productId: '12', objectKey: uploadKey }),
    ).resolves.toEqual({
      objectKey: finalKey,
      url: `https://api.elchi.test/media/marketplace-media/${finalKey}`,
      type: CreativeType.IMAGE,
      mimeType: 'image/png',
      size: 2048,
    });
    expect(conditions.setMatchETag).toHaveBeenCalledWith('e1');
    expect(minio.copyObject).toHaveBeenCalledWith(
      'marketplace-media',
      finalKey,
      `/marketplace-media/${uploadKey}`,
      conditions,
    );
    expect(minio.removeObject).toHaveBeenCalledWith(
      'marketplace-media',
      uploadKey,
    );
  });

  it('«video/mp4» deb yuklangan HTML — yuklama o‘chiriladi va 400, ochiq papkaga ko‘chmaydi', async () => {
    minio.statObject.mockResolvedValue({
      size: 300,
      etag: 'e1',
      metaData: { 'content-type': 'video/mp4' },
    });
    minio.getPartialObject.mockResolvedValue(
      withEtag(Readable.from([Buffer.from('<html><script>…</script>')])),
    );
    const key = `creative-uploads/12/${uuid}.mp4`;
    await expect(
      make().verify({ productId: '12', objectKey: key }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(minio.removeObject).toHaveBeenCalledWith('marketplace-media', key);
    expect(minio.copyObject).not.toHaveBeenCalled();
  });

  it('boshqa mahsulot kaliti, ochiq papka kaliti yoki yuklanmagan fayl — 400', async () => {
    const service = make();
    for (const objectKey of [
      `creative-uploads/13/${uuid}.png`,
      finalKey,
      `products/${uuid}.png`,
    ])
      await expect(
        service.verify({ productId: '12', objectKey }),
      ).rejects.toBeInstanceOf(BadRequestException);
    minio.statObject.mockRejectedValue(minioError('NotFound'));
    await expect(
      service.verify({ productId: '12', objectKey: uploadKey }),
    ).rejects.toThrow('Fayl topilmadi');
  });

  it('qayta tasdiq: yuklama allaqachon ko‘chirilgan — yakuniy fayl qaytadi, hech narsa o‘chirilmaydi', async () => {
    minio.statObject.mockImplementation(
      async (_bucket: string, key: string) => {
        if (key === uploadKey) throw minioError('NotFound');
        return {
          size: 2048,
          etag: 'e1',
          metaData: { 'content-type': 'image/png' },
        };
      },
    );
    await expect(
      make().verify({ productId: '12', objectKey: uploadKey }),
    ).resolves.toMatchObject({ objectKey: finalKey, size: 2048 });
    expect(minio.removeObject).not.toHaveBeenCalled();
    expect(minio.copyObject).not.toHaveBeenCalled();
  });

  it('tekshiruv paytida fayl qayta yuklandi (ETag mos emas) — 409, ochiq papkaga ko‘chmadi', async () => {
    minio.statObject.mockResolvedValue({
      size: 2048,
      etag: 'e1',
      metaData: { 'content-type': 'image/png' },
    });
    minio.getPartialObject.mockResolvedValue(png());
    minio.copyObject.mockRejectedValue(minioError('PreconditionFailed'));
    await expect(
      make().verify({ productId: '12', objectKey: uploadKey }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(minio.removeObject).not.toHaveBeenCalled();
  });

  it('baytlar o‘qilayotganda fayl almashtirildi (o‘qilgan ETag stat dagidan boshqa) — 409, ko‘chirilmaydi', async () => {
    minio.statObject.mockResolvedValue({
      size: 2048,
      etag: 'e1',
      metaData: { 'content-type': 'image/png' },
    });
    minio.getPartialObject.mockResolvedValue(png('e2'));
    await expect(
      make().verify({ productId: '12', objectKey: uploadKey }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(minio.copyObject).not.toHaveBeenCalled();
  });

  it('imzolovchi kalitning faqat bittasi berilgan — ishga tushmaydi (jim root kalitiga qaytmaydi)', () => {
    const half = {
      ...config,
      get: (key: string, fallback?: unknown) =>
        ({ MINIO_USE_SSL: false, CREATIVE_UPLOAD_ACCESS_KEY: 'uploader' })[
          key
        ] ?? fallback,
    };
    expect(() => new CreativeFileService(half as never)).toThrow(
      'birga beriladi',
    );
  });

  it('MinIO ishlamasa — 503 («topilmadi» emas), fayl o‘chirilmaydi', async () => {
    minio.statObject.mockRejectedValue(minioError('AccessDenied'));
    await expect(
      make().verify({ productId: '12', objectKey: uploadKey }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(minio.removeObject).not.toHaveBeenCalled();
  });

  it('yuklama papkalariga 1 kunlik muddat (kreativ va yopiq hujjat): boshqa lifecycle qoidalari saqlanadi', async () => {
    minio.getBucketLifecycle.mockResolvedValue({
      Rule: [{ ID: 'boshqa', Status: 'Enabled', Filter: { Prefix: 'tmp/' } }],
    });
    await make().onApplicationBootstrap();
    expect(minio.setBucketLifecycle).toHaveBeenCalledWith('marketplace-media', {
      Rule: [
        { ID: 'boshqa', Status: 'Enabled', Filter: { Prefix: 'tmp/' } },
        {
          ID: 'elchi-creative-uploads-expire',
          Status: 'Enabled',
          Filter: { Prefix: 'creative-uploads/' },
          Expiration: { Days: 1 },
        },
        // BE-30: optovikning yopiq hujjat yuklamalari ham
        {
          ID: 'elchi-private-uploads-expire',
          Status: 'Enabled',
          Filter: { Prefix: 'private-uploads/' },
          Expiration: { Days: 1 },
        },
      ],
    });
  });

  it('o‘chirish: faqat kreativ yoki yuklama kaliti', async () => {
    const service = make();
    await expect(service.remove({ objectKey: finalKey })).resolves.toEqual({
      removed: true,
    });
    await expect(service.remove({ objectKey: uploadKey })).resolves.toEqual({
      removed: true,
    });
    await expect(
      service.remove({ objectKey: `products/${uuid}.png` }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
