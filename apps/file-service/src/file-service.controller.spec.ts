import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { FileServiceService } from './file-service.service';

jest.mock('minio', () => ({ Client: jest.fn() }));

describe('FileServiceService', () => {
  const minio = {
    bucketExists: jest.fn(),
    makeBucket: jest.fn(),
    setBucketPolicy: jest.fn(),
    putObject: jest.fn(),
  };
  let service: FileServiceService;

  beforeEach(() => {
    jest.clearAllMocks();
    (Client as jest.MockedClass<typeof Client>).mockImplementation(
      () => minio as unknown as Client,
    );
    const values: Record<string, string | number> = {
      MINIO_ENDPOINT: 'localhost',
      MINIO_PORT: 9000,
      MINIO_ACCESS_KEY: 'access',
      MINIO_SECRET_KEY: 'secret',
      MINIO_BUCKET: 'marketplace-media',
      MINIO_PUBLIC_URL: 'http://localhost:9000/',
    };
    const config = {
      getOrThrow: jest.fn((key: string) => values[key]),
      get: jest.fn((key: string, fallback: unknown) => values[key] ?? fallback),
    } as unknown as ConfigService;
    service = new FileServiceService(config);
  });

  it('bucket bo‘lmasa yaratadi va products public-read policy o‘rnatadi', async () => {
    minio.bucketExists.mockResolvedValue(false);

    await service.onModuleInit();

    expect(minio.makeBucket).toHaveBeenCalledWith('marketplace-media');
    expect(minio.setBucketPolicy).toHaveBeenCalledWith(
      'marketplace-media',
      expect.stringContaining('arn:aws:s3:::marketplace-media/products/*'),
    );
    // C6.9: banner rasmlari ham ochiq bo'lmasa storefront ularni ko'rsata olmaydi.
    expect(minio.setBucketPolicy).toHaveBeenCalledWith(
      'marketplace-media',
      expect.stringContaining('arn:aws:s3:::marketplace-media/banners/*'),
    );
  });

  it('banner rasmini ochiq banners/ papkasiga yuklaydi', async () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    const result = await service.uploadFile({
      originalName: 'banner.jpg',
      mimeType: 'image/jpeg',
      size: buffer.length,
      base64: buffer.toString('base64'),
      folder: 'banners',
    });

    expect(minio.putObject).toHaveBeenCalledWith(
      'marketplace-media',
      expect.stringMatching(/^banners\/.+\.jpg$/),
      buffer,
      buffer.length,
      { 'Content-Type': 'image/jpeg' },
    );
    expect(result.url).toMatch(
      /^http:\/\/localhost:9000\/marketplace-media\/banners\/.+\.jpg$/,
    );
  });

  it('ruxsat etilmagan papka nomini rad etadi', async () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    await expect(
      service.uploadFile({
        originalName: 'x.jpg',
        mimeType: 'image/jpeg',
        size: buffer.length,
        base64: buffer.toString('base64'),
        folder: '../secret' as never,
      }),
    ).rejects.toThrow('Fayl papkasi noto‘g‘ri');
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('haqiqiy PNG faylni MinIO’ga yuklab public URL qaytaradi', async () => {
    const buffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const result = await service.uploadFile({
      originalName: 'product.png',
      mimeType: 'image/png',
      size: buffer.length,
      base64: buffer.toString('base64'),
    });

    expect(minio.putObject).toHaveBeenCalledWith(
      'marketplace-media',
      expect.stringMatching(/^products\/.+\.png$/),
      buffer,
      buffer.length,
      { 'Content-Type': 'image/png' },
    );
    expect(result.url).toMatch(
      /^http:\/\/localhost:9000\/marketplace-media\/products\/.+\.png$/,
    );
  });

  it('MIME va fayl signature mos kelmasa 400 qaytaradi', async () => {
    const buffer = Buffer.from('not-a-real-png');

    await expect(
      service.uploadFile({
        originalName: 'fake.png',
        mimeType: 'image/png',
        size: buffer.length,
        base64: buffer.toString('base64'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(minio.putObject).not.toHaveBeenCalled();
  });
});
