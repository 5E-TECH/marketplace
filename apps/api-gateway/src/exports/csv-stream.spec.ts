import {
  Controller,
  Get,
  INestApplication,
  StreamableFile,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { get } from 'http';
import { AddressInfo } from 'net';
import { csvStream } from './csv-stream';

@Controller()
class ExportTestController {
  @Get('ok')
  ok(): Promise<StreamableFile> {
    const chunks = [
      { lines: ['a;b', '1;2'], nextAfterId: '1' },
      { lines: ['3;4'], nextAfterId: null },
    ];
    return csvStream('x.csv', async () => chunks.shift()!);
  }

  @Get('broken')
  broken(): Promise<StreamableFile> {
    return csvStream('x.csv', async (afterId) => {
      if (afterId) throw new Error('servis yo‘q');
      return { lines: ['a;b'], nextAfterId: '1' };
    });
  }

  @Get('dead')
  dead(): Promise<StreamableFile> {
    return csvStream('x.csv', async () => {
      throw new Error('servis yo‘q');
    });
  }
}

describe('CSV oqimi (BE-25) — haqiqiy HTTP', () => {
  let app: INestApplication;
  let base: string;
  const fetchAll = (path: string) =>
    new Promise<{ status: number; body: string; complete: boolean }>(
      (resolve) => {
        get(`${base}${path}`, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (part: string) => (body += part));
          const done = () =>
            resolve({
              status: res.statusCode ?? 0,
              body,
              complete: res.complete,
            });
          res.on('end', done);
          res.on('error', done);
        });
      },
    );

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ExportTestController],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(() => app.close());

  it('bo‘laklar ketma-ket, BOM bilan', async () => {
    expect(await fetchAll('/ok')).toEqual({
      status: 200,
      body: '\uFEFFa;b\r\n1;2\r\n3;4\r\n',
      complete: true,
    });
  });

  it('keyingi bo‘lakda xato — ulanish uziladi (chala fayl to‘liq bo‘lib tugamaydi)', async () => {
    const res = await fetchAll('/broken');
    expect(res.complete).toBe(false);
  });

  it('birinchi bo‘lakda xato — 200 emas', async () => {
    expect((await fetchAll('/dead')).status).toBe(500);
  });
});
