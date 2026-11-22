import { BadRequestException } from '@nestjs/common';
import { PrivateFileService, signatureMatches } from './private-file.service';

const config = {
  getOrThrow: (key: string) =>
    ({
      MINIO_ENDPOINT: 'minio',
      MINIO_PORT: 9000,
      MINIO_ACCESS_KEY: 'k',
      MINIO_SECRET_KEY: 's',
      MINIO_BUCKET: 'marketplace-media',
      MINIO_PUBLIC_URL: 'https://api.example.uz/media',
    })[key],
  get: (_key: string, fallback?: unknown) => fallback,
};

describe('BE-30 yopiq hujjatlar (file-service)', () => {
  it('bosh baytlar: PDF, JPEG, PNG; HTML «PDF» deb — mos emas', () => {
    expect(signatureMatches(Buffer.from('%PDF-1.7\n'), 'application/pdf')).toBe(
      true,
    );
    expect(
      signatureMatches(Buffer.from('<html><body>'), 'application/pdf'),
    ).toBe(false);
    expect(
      signatureMatches(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'),
    ).toBe(true);
    expect(
      signatureMatches(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image/png',
      ),
    ).toBe(true);
  });

  it('yuklash: ruxsatsiz tur yoki 10 MB dan katta — 400; kalit optovik papkasida', async () => {
    const svc = new PrivateFileService(config as never);
    await expect(
      svc.uploadPolicy({
        wholesalerId: '15',
        contentType: 'text/html',
        size: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.uploadPolicy({
        wholesalerId: '15',
        contentType: 'application/pdf',
        size: 10 * 1024 * 1024 + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tasdiq: boshqa optovik kaliti yoki ochiq papka — 400 (MinIO ga murojaat yo‘q); o‘qish faqat yopiq papkadan', async () => {
    const svc = new PrivateFileService(config as never);
    const key = 'private-uploads/16/0f0e8f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6.pdf';
    await expect(
      svc.verify({ wholesalerId: '15', objectKey: key }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.verify({ wholesalerId: '15', objectKey: 'creatives/1/x.png' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.get({
        objectKey: 'creatives/1/0f0e8f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6.png',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.get({ objectKey: 'private/wholesaler/15/../16/x.pdf' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
