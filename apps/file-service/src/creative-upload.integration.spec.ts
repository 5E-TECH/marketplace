import { AddressInfo } from 'node:net';
import http from 'node:http';
import { Client } from 'minio';
import { CreativeType } from '@app/common';
import { CreativeFileService } from './creative-file.service';
import { FileServiceService } from './file-service.service';

const endpoint = process.env.TEST_MINIO_ENDPOINT;
const describeWithMinio = endpoint ? describe : describe.skip;
const MB = 1024 * 1024;

/**
 * BE-08 haqiqiy MinIO da (`TEST_MINIO_ENDPOINT`, `TEST_MINIO_PORT`, `TEST_MINIO_ACCESS_KEY`, `TEST_MINIO_SECRET_KEY`).
 * Prod dagi kabi: brauzer `https://api…/media/<bucket>` ga yuklaydi, Caddy `/media` prefiksini olib tashlab MinIO ga
 * uzatadi (`handle_path /media/*`). Testda shu ishni kichik proksi qiladi — imzolangan POST prefiks olib tashlanganda
 * ham o‘tishi tekshiriladi (TC4 asosi).
 */
describeWithMinio(
  'BE-08 kreativ yuklash (haqiqiy MinIO, /media proksi orqali)',
  () => {
    const bucket = `be08-test-${Date.now()}`;
    const port = Number(process.env.TEST_MINIO_PORT ?? 9000);
    const accessKey = process.env.TEST_MINIO_ACCESS_KEY!;
    const secretKey = process.env.TEST_MINIO_SECRET_KEY!;
    let proxy: http.Server;
    let publicUrl: string;
    let creatives: CreativeFileService;
    const admin = new Client({
      endPoint: endpoint!,
      port,
      useSSL: false,
      accessKey,
      secretKey,
    });

    /** Caddy `handle_path /media/*` kabi: prefiksni olib tashlaydi, Host sarlavhasini o‘zgartirmaydi. */
    const startProxy = () =>
      new Promise<void>((resolve) => {
        proxy = http.createServer((req, res) => {
          if (!req.url?.startsWith('/media/')) {
            res.writeHead(404).end();
            return;
          }
          const upstream = http.request(
            {
              host: endpoint,
              port,
              method: req.method,
              path: req.url.slice('/media'.length),
              headers: req.headers,
            },
            (reply) => {
              res.writeHead(reply.statusCode ?? 502, reply.headers);
              reply.pipe(res);
            },
          );
          req.pipe(upstream);
        });
        proxy.listen(0, '127.0.0.1', () => resolve());
      });

    const config = (overrides: Record<string, unknown> = {}) => {
      const values: Record<string, unknown> = {
        MINIO_ENDPOINT: endpoint,
        MINIO_PORT: port,
        MINIO_USE_SSL: false,
        MINIO_ACCESS_KEY: accessKey,
        MINIO_SECRET_KEY: secretKey,
        MINIO_BUCKET: bucket,
        MINIO_PUBLIC_URL: publicUrl,
        ...overrides,
      };
      return {
        getOrThrow: (key: string) => values[key],
        get: (key: string, fallback?: unknown) => values[key] ?? fallback,
      } as never;
    };

    /** Brauzer kabi: avval policy maydonlari, oxirida fayl. */
    const post = async (
      policy: { url: string; fields: Record<string, string> },
      content: Buffer,
      contentType: string,
    ) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(policy.fields))
        form.append(key, value);
      form.set('Content-Type', contentType);
      form.append(
        'file',
        new Blob([new Uint8Array(content)], { type: contentType }),
        'video',
      );
      return fetch(policy.url, { method: 'POST', body: form });
    };

    const mp4 = (size: number) => {
      const buffer = Buffer.alloc(size);
      Buffer.from([0, 0, 0, 0x18]).copy(buffer, 0);
      Buffer.from('ftypmp42', 'ascii').copy(buffer, 4);
      return buffer;
    };

    beforeAll(async () => {
      await startProxy();
      publicUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/media`;
      // bucket va ochiq o‘qish siyosati (creatives/ ham) — file-service ishga tushganda qiladigan ish
      await new FileServiceService(config()).onModuleInit();
      creatives = new CreativeFileService(config());
    });

    afterAll(async () => {
      const names: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const stream = admin.listObjectsV2(bucket, '', true);
        stream.on('data', (item) => item.name && names.push(item.name));
        stream.on('end', () => resolve());
        stream.on('error', reject);
      }).catch(() => undefined);
      if (names.length) await admin.removeObjects(bucket, names);
      await admin.removeBucket(bucket).catch(() => undefined);
      await new Promise((resolve) => proxy?.close(resolve));
    });

    it('TC1: 80 MB mp4 imzolangan POST bilan /media orqali yuklandi, tekshiruvdan o‘tdi va ochiq havola bilan o‘qiladi', async () => {
      const size = 80 * MB;
      const policy = await creatives.uploadPolicy({
        productId: '12',
        type: CreativeType.VIDEO,
        contentType: 'video/mp4',
        size,
      });
      expect(policy.url).toBe(`${publicUrl}/${bucket}`);
      const response = await post(policy, mp4(size), 'video/mp4');
      expect([200, 201, 204]).toContain(response.status);

      const file = await creatives.verify({
        productId: '12',
        objectKey: policy.objectKey,
      });
      expect(file).toMatchObject({
        type: CreativeType.VIDEO,
        mimeType: 'video/mp4',
        size,
        url: `${publicUrl}/${bucket}/${policy.objectKey}`,
      });
      // ochiq havola — tokensiz
      const head = await fetch(file.url, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-type')).toBe('video/mp4');
      expect(Number(head.headers.get('content-length'))).toBe(size);
    }, 60_000);

    it('TC3: rasm yuklandi va ochiq havola bilan o‘qiladi', async () => {
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(1024),
      ]);
      const policy = await creatives.uploadPolicy({
        productId: '12',
        type: CreativeType.IMAGE,
        contentType: 'image/png',
        size: png.length,
      });
      expect([200, 201, 204]).toContain(
        (await post(policy, png, 'image/png')).status,
      );
      const file = await creatives.verify({
        productId: '12',
        objectKey: policy.objectKey,
      });
      const get = await fetch(file.url);
      expect(get.status).toBe(200);
      expect(Buffer.from(await get.arrayBuffer()).subarray(0, 8)).toEqual(
        png.subarray(0, 8),
      );
    });

    it('TC2: imzodan boshqa tur yoki chegaradan katta fayl — MinIO o‘zi rad etadi', async () => {
      const image = await creatives.uploadPolicy({
        productId: '12',
        type: CreativeType.IMAGE,
        contentType: 'image/png',
        size: 1024,
      });
      // tur almashtirildi
      expect((await post(image, Buffer.alloc(1024), 'text/html')).status).toBe(
        403,
      );
      // rasm chegarasi 10 MB — 11 MB lik fayl
      const tooBig = await post(image, Buffer.alloc(11 * MB), 'image/png');
      expect(tooBig.status).toBeGreaterThanOrEqual(400);
      await expect(
        admin.statObject(bucket, image.objectKey),
      ).rejects.toBeDefined();
    });

    it('«video/mp4» deb yuklangan HTML — tekshiruvda rad etiladi va fayl o‘chiriladi', async () => {
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      const policy = await creatives.uploadPolicy({
        productId: '12',
        type: CreativeType.VIDEO,
        contentType: 'video/mp4',
        size: html.length,
      });
      expect([200, 201, 204]).toContain(
        (await post(policy, html, 'video/mp4')).status,
      );
      await expect(
        creatives.verify({ productId: '12', objectKey: policy.objectKey }),
      ).rejects.toThrow('mos emas');
      await expect(
        admin.statObject(bucket, policy.objectKey),
      ).rejects.toBeDefined();
    });
  },
);
