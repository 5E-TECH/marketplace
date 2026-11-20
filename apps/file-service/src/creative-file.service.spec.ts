import { BadRequestException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { CreativeType } from '@app/common';
import { CreativeFileService } from './creative-file.service';

const minio = {
  newPostPolicy: jest.fn(),
  presignedPostPolicy: jest.fn(),
  statObject: jest.fn(),
  getPartialObject: jest.fn(),
  removeObject: jest.fn(),
};
// jest.mock importlardan oldinga ko‘tariladi (hoist)
jest.mock('minio', () => ({ Client: jest.fn(() => minio) }));

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

  beforeEach(() => {
    jest.clearAllMocks();
    minio.newPostPolicy.mockReturnValue(policy);
    minio.presignedPostPolicy.mockResolvedValue({
      postURL: 'http://minio:9000/marketplace-media',
      formData: { policy: 'p', 'x-amz-signature': 's' },
    });
  });

  it('TC1: 80 MB mp4 — imzolangan POST: ochiq manzil, mahsulot kaliti, tur va hajm oralig‘i policy da', async () => {
    const result = await make().uploadPolicy({
      productId: '12',
      type: CreativeType.VIDEO,
      contentType: 'video/mp4',
      size: 80 * MB,
    });
    expect(result.url).toBe('https://api.elchi.test/media/marketplace-media');
    expect(result.objectKey).toMatch(/^creatives\/12\/[0-9a-f-]{36}\.mp4$/);
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

  it('TC3: rasm — tekshiruvdan o‘tadi va ochiq havola qaytadi', async () => {
    minio.statObject.mockResolvedValue({
      size: 2048,
      metaData: { 'content-type': 'image/png' },
    });
    minio.getPartialObject.mockResolvedValue(
      Readable.from([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
      ]),
    );
    const key = 'creatives/12/7b0c3e1a-1111-4222-8333-944455556666.png';
    await expect(
      make().verify({ productId: '12', objectKey: key }),
    ).resolves.toEqual({
      objectKey: key,
      url: `https://api.elchi.test/media/marketplace-media/${key}`,
      type: CreativeType.IMAGE,
      mimeType: 'image/png',
      size: 2048,
    });
  });

  it('«video/mp4» deb yuklangan HTML — o‘chiriladi va 400 (ochiq havolada tarqalmasin)', async () => {
    minio.statObject.mockResolvedValue({
      size: 300,
      metaData: { 'content-type': 'video/mp4' },
    });
    minio.getPartialObject.mockResolvedValue(
      Readable.from([Buffer.from('<html><script>…</script>')]),
    );
    const key = 'creatives/12/7b0c3e1a-1111-4222-8333-944455556666.mp4';
    await expect(
      make().verify({ productId: '12', objectKey: key }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(minio.removeObject).toHaveBeenCalledWith('marketplace-media', key);
  });

  it('boshqa mahsulot kaliti yoki yuklanmagan fayl — 400', async () => {
    const service = make();
    await expect(
      service.verify({
        productId: '12',
        objectKey: 'creatives/13/7b0c3e1a-1111-4222-8333-944455556666.mp4',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    minio.statObject.mockRejectedValue(new Error('NotFound'));
    await expect(
      service.verify({
        productId: '12',
        objectKey: 'creatives/12/7b0c3e1a-1111-4222-8333-944455556666.mp4',
      }),
    ).rejects.toThrow('Fayl topilmadi');
  });
});
