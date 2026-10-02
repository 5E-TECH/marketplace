import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// connectMicroservice() o'zi yaratgan microservice'ni "init qilingan" deb
// belgilaydi, shuning uchun faqat startAllMicroservices() bo'lsa @Cron va
// onModuleInit hech qachon ishga tushmaydi (reservation sweeper, outbox relay,
// notification retry). Har bir RMQ servis bootstrap'ida app.init() bo'lishi shart.
describe('microservice bootstrap', () => {
  const appsDir = join(__dirname, '..', 'apps');
  const hybridMains = readdirSync(appsDir)
    .map((app) => join(appsDir, app, 'src', 'main.ts'))
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => source.includes('connectMicroservice('));

  it('RMQ servislar topiladi', () => {
    expect(hybridMains.length).toBeGreaterThanOrEqual(10);
  });

  it.each(hybridMains.map(({ path, source }) => [path, source]))(
    '%s startAllMicroservices()dan keyin app.init() chaqiradi',
    (_path, source) => {
      const start = source.indexOf('startAllMicroservices()');
      const init = source.indexOf('app.init()');
      expect(start).toBeGreaterThan(-1);
      expect(init).toBeGreaterThan(start);
    },
  );
});
