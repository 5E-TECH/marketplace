import { BadRequestException } from '@nestjs/common';
import {
  photoType,
  PrivateFileService,
  signatureMatches,
} from './private-file.service';

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

  describe('BE-25 5-tur: sotuvchi ma’lumotnomasi', () => {
    const pdf = Buffer.from('%PDF-1.7\nnamuna');
    const make = (over: Record<string, unknown> = {}) => {
      const svc = new PrivateFileService(config as never);
      const client = {
        putObject: jest.fn().mockResolvedValue({}),
        statObject: jest.fn(),
        copyObject: jest.fn().mockResolvedValue({}),
        removeObject: jest.fn().mockResolvedValue(undefined),
        ...over,
      };
      (svc as unknown as { client: unknown }).client = client;
      return { svc, client };
    };
    const ID36 = '0f0e8f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6';

    it('saqlash: sotuvchi papkasiga, nomi metama’lumotda (kirill buzilmaydi), kengaytma turdan', async () => {
      const { svc, client } = make();
      const result = await svc.storeAffiliateDocument({
        affiliateId: '77',
        fileName: '../../Маълумотнома ʻ1.html',
        base64: pdf.toString('base64'),
      });
      expect(result.name).toBe('Маълумотнома ʻ1.pdf');
      const [bucket, key, body, size, meta] = client.putObject.mock
        .calls[0] as [string, string, Buffer, number, Record<string, string>];
      expect(bucket).toBe('marketplace-media');
      expect(key).toBe(`private-uploads/affiliate/77/${result.documentId}`);
      expect(body.equals(pdf)).toBe(true);
      expect(size).toBe(pdf.length);
      expect(
        Buffer.from(meta['X-Amz-Meta-elchi-name'], 'base64url').toString(),
      ).toBe(result.name);
    });

    it('tarkib turga mos emas, bo‘sh, katta — rad, MinIO ga yozilmaydi', async () => {
      const { svc, client } = make();
      const store = (body: Buffer) =>
        svc.storeAffiliateDocument({
          affiliateId: '77',
          fileName: 'x',
          base64: body.toString('base64'),
        });
      await expect(store(Buffer.from('<html>'))).rejects.toMatchObject({
        response: { errorCode: 'FILE_TYPE_INVALID' },
      });
      await expect(store(Buffer.alloc(0))).rejects.toMatchObject({
        response: { errorCode: 'FILE_REQUIRED' },
      });
      await expect(
        store(Buffer.alloc(10 * 1024 * 1024 + 1, 1)),
      ).rejects.toMatchObject({ response: { errorCode: 'FILE_TOO_LARGE' } });
      expect(client.putObject).not.toHaveBeenCalled();
    });

    it('yuborish: faqat o‘z papkasidan, har safar yangi kalit; boshqa sotuvchiniki topilmaydi', async () => {
      const { svc, client } = make();
      client.statObject.mockImplementation((_b: string, key: string) =>
        key.startsWith('private-uploads/affiliate/77/')
          ? Promise.resolve({
              size: 10,
              etag: 'e1',
              metaData: {
                'content-type': 'application/pdf',
                'elchi-name': Buffer.from('maqom.pdf').toString('base64url'),
              },
            })
          : Promise.reject(
              Object.assign(new Error('yo‘q'), { code: 'NotFound' }),
            ),
      );
      const documentId = `${ID36}.pdf`;
      const deadline = Date.now() + 10_000;
      const one = await svc.commitAffiliateDocument({
        affiliateId: '77',
        documentId,
        deadline,
      });
      const two = await svc.commitAffiliateDocument({
        affiliateId: '77',
        documentId,
        deadline,
      });
      expect(one).toMatchObject({
        fileName: 'maqom.pdf',
        contentType: 'application/pdf',
        size: 10,
      });
      expect(one.objectKey).toMatch(
        /^private\/affiliate\/77\/[0-9a-f-]{36}\.pdf$/,
      );
      expect(one.objectKey).not.toBe(two.objectKey);
      expect(client.copyObject).toHaveBeenCalledTimes(2);
      // vaqtinchalik nusxa o‘chirilmaydi — qayta urinish ishlaydi
      expect(client.removeObject).not.toHaveBeenCalled();
      for (const bad of [
        { affiliateId: '78', documentId, deadline },
        { affiliateId: '77', documentId: `../78/${documentId}`, deadline },
        { affiliateId: '77', documentId: 'doc-1', deadline },
        // gateway kutib bo‘lgan (504) — kechikkan buyruq nusxa qoldirmaydi
        { affiliateId: '77', documentId, deadline: Date.now() - 1 },
        { affiliateId: '77', documentId } as never,
      ])
        await expect(svc.commitAffiliateDocument(bad)).rejects.toMatchObject({
          response: { errorCode: 'DOCUMENT_NOT_FOUND' },
        });
    });

    it('o‘chirish faqat o‘z yopiq papkasidan; o‘qish yuborilmagan fayldan emas', async () => {
      const { svc, client } = make();
      await svc.removeAffiliateDocument({
        affiliateId: '77',
        objectKey: `private/affiliate/77/${ID36}.pdf`,
      });
      expect(client.removeObject).toHaveBeenCalledTimes(1);
      for (const objectKey of [
        `private/affiliate/78/${ID36}.pdf`,
        `private/wholesaler/77/${ID36}.pdf`,
        `private/affiliate/77/../78/${ID36}.pdf`,
        'creatives/1/x.png',
      ])
        await expect(
          svc.removeAffiliateDocument({ affiliateId: '77', objectKey }),
        ).rejects.toBeInstanceOf(BadRequestException);
      expect(client.removeObject).toHaveBeenCalledTimes(1);
      await expect(
        svc.get({ objectKey: `private-uploads/affiliate/77/${ID36}.pdf` }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('BE-25 qaytarish rasmi: tur bosh baytlardan, 5 MB, yopiq kalit; boshqa kalit o‘chirilmaydi', async () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBPVP8 '),
    ]);
    expect(photoType(webp)).toBe('image/webp');
    expect(photoType(Buffer.from('%PDF-1.7 hujjat'))).toBeNull();
    const svc = new PrivateFileService(config as never);
    const client = {
      putObject: jest.fn(async () => undefined),
      removeObject: jest.fn(async () => undefined),
    };
    (svc as unknown as { client: unknown }).client = client;
    const stored = await svc.storeReturnPhoto({
      returnId: '3',
      base64: webp.toString('base64'),
    });
    expect(stored).toMatchObject({ contentType: 'image/webp', size: 16 });
    expect(stored.objectKey).toMatch(
      /^private\/returns\/3\/[0-9a-f-]{36}\.webp$/,
    );
    await expect(
      svc.storeReturnPhoto({
        returnId: '3',
        base64: Buffer.from('<html>').toString('base64'),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'FILE_TYPE_INVALID' }),
    });
    await expect(
      svc.storeReturnPhoto({
        returnId: '3',
        base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'),
      }),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      svc.storeReturnPhoto({ returnId: '../1', base64: 'AA==' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await svc.removeReturnPhoto({ objectKey: stored.objectKey });
    expect(client.removeObject).toHaveBeenCalledTimes(1);
    for (const objectKey of [
      'private/wholesaler/15/0f0e8f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6.pdf',
      'products/1.jpg',
    ])
      await expect(svc.removeReturnPhoto({ objectKey })).rejects.toBeInstanceOf(
        BadRequestException,
      );
  });
});
