// BE-26: deploy/Caddyfile Swagger'ni tashqaridan yopadi. Test haqiqiy
// caddy:2.10-alpine ni (CI undan oldin `caddy validate` uchun tortib oladi)
// soxta backend bilan ishga tushiradi va so'rovlar backendga yetmasligini
// tekshiradi. Docker yoki image bo'lmasa test o'tkazib yuboriladi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';

const IMAGE = 'caddy:2.10-alpine';

function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8' });
}

function dockerReady() {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) {
    return 'docker yo‘q';
  }
  if (docker(['image', 'inspect', IMAGE]).status !== 0) {
    return `${IMAGE} image yo‘q`;
  }
  return null;
}

// Xom HTTP/1.1 so'rov: fetch() `http:http://...` kabi so'rov qatorini
// yubora olmaydi, aylanib o'tishni tekshirish uchun esa aynan shu kerak.
function rawRequest(port, target, { host = 'api.test', method = 'GET' } = {}) {
  return new Promise((resolvePromise, reject) => {
    const socket = connect(port, '127.0.0.1');
    let data = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('timeout')));
    socket.on('connect', () => {
      socket.write(
        `${method} ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
      );
    });
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
    });
    socket.on('error', reject);
    socket.on('end', () => {
      const status = Number(data.split(' ')[1]);
      const body = data.split('\r\n\r\n').slice(1).join('\r\n\r\n');
      resolvePromise({ status, body });
    });
  });
}

async function startStack(t) {
  const dir = await mkdtemp(join(tmpdir(), 'be26-caddy-'));
  const id = `be26-caddy-${process.pid}-${Date.now()}`;
  const net = `${id}-net`;
  t.after(async () => {
    docker(['rm', '-f', `${id}-api`, `${id}-stub`]);
    docker(['network', 'rm', net]);
    await rm(dir, { recursive: true, force: true });
  });

  // Soxta backend: api-gateway va minio nomlari bilan; har javobda kelgan URI.
  await writeFile(
    join(dir, 'stub.Caddyfile'),
    `{
	admin off
	auto_https off
}
:3000 {
	respond "BACKEND {method} {uri}" 200
}
:9000 {
	respond "MINIO {method} {uri}" 200
}
`,
  );
  assert.equal(docker(['network', 'create', net]).status, 0);
  const stub = docker([
    'run',
    '-d',
    '--name',
    `${id}-stub`,
    '--network',
    net,
    '--network-alias',
    'api-gateway',
    '--network-alias',
    'minio',
    '-v',
    `${join(dir, 'stub.Caddyfile')}:/etc/caddy/Caddyfile:ro`,
    IMAGE,
  ]);
  assert.equal(stub.status, 0, stub.stderr);
  const api = docker([
    'run',
    '-d',
    '--name',
    `${id}-api`,
    '--network',
    net,
    '-e',
    'DOMAIN=http://api.test',
    '-e',
    'APP_DOMAIN=http://app.test',
    '-e',
    'TLS_EMAIL=ops@example.com',
    '-e',
    'API_ORIGIN=https://api.test',
    '-p',
    '127.0.0.1::80',
    '-v',
    `${resolve('deploy/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
    IMAGE,
  ]);
  assert.equal(api.status, 0, api.stderr);

  const port = Number(
    docker(['port', `${id}-api`, '80/tcp'])
      .stdout.trim()
      .split(':')
      .pop(),
  );
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await rawRequest(port, '/api/v1/health');
      if (res.body.startsWith('BACKEND')) return port;
    } catch {
      // Caddy hali ko'tarilmagan
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Caddy ko'tarilmadi:\n${docker(['logs', `${id}-api`]).stderr}`,
  );
}

// `skip: null` Node 22 da testni ishlatadi-yu, SKIP deb hisoblaydi — shuning
// uchun `false`.
const skip = dockerReady() ?? false;

test(
  'Caddyfile hides every Swagger path from the public API host',
  { skip },
  async (t) => {
    const port = await startStack(t);

    const hidden = [
      '/api/docs',
      '/api/docs/',
      '/api/docs/index.html',
      '/api/docs/swagger-ui-init.js',
      '/api/docs/docs/swagger-ui-init.js',
      '/api/docs/swagger-ui-bundle.js',
      '/api/docs-json',
      '/api/docs-yaml',
      '/API/DOCS',
      '/Api/Docs-Json',
      '/api//docs',
      '//api/docs',
      '/api/./docs',
      '/api/v1/../docs',
      '/api/%64ocs',
      '/api/docs%2Djson',
      '/api/docs-json?format=json',
    ];
    for (const target of hidden) {
      for (const method of ['GET', 'HEAD', 'POST']) {
        const res = await rawRequest(port, target, { method });
        assert.equal(res.status, 404, `${method} ${target} → ${res.status}`);
        assert.ok(
          !res.body.includes('BACKEND'),
          `${method} ${target} backendga yetdi`,
        );
      }
    }
  },
);

test(
  'Caddyfile rejects request targets that do not start with "/"',
  { skip },
  async (t) => {
    const port = await startStack(t);

    for (const target of [
      'http:http://x/api/docs-json',
      'http:http://x/api/docs/swagger-ui-init.js',
      'x:http://x/API/DOCS-YAML',
    ]) {
      const res = await rawRequest(port, target);
      assert.equal(res.status, 400, `${target} → ${res.status}`);
      assert.ok(!res.body.includes('BACKEND'), `${target} backendga yetdi`);
    }
    // Oddiy absolute-form so'rov (yo'li "/" bilan) avvalgidek ishlaydi.
    const absolute = await rawRequest(port, 'http://api.test/api/v1/health');
    assert.equal(absolute.status, 200);
    assert.equal(absolute.body, 'BACKEND GET /api/v1/health');
  },
);

// Express (parseurl) `#` ko'rsa `url.parse` ga o'tadi va `//a@x/...` dagi `a@x` ni login@host deb
// tashlaydi: haqiqiy gateway'da bu so'rovlar Swagger'ni berardi (lokal stendda tekshirilgan, BE-26).
// Soxta backend URI ni shunchaki qaytaradi, shuning uchun bu yerda faqat «backendga yetmadi» tekshiriladi.
test(
  'BE-26: Caddyfile rejects targets that Caddy and Express parse differently',
  { skip },
  async (t) => {
    const port = await startStack(t);

    for (const target of [
      '//a@x/api/docs-json?#',
      '//a@x/API/DOCS?#',
      '//a@x/api/docs/swagger-ui-init.js?#',
      '//a@x/api/docs-yaml?x=1#',
      '//%2e%2e%2fx@y/api/docs-yaml?#',
      '/%2f/a@x/api/docs-json?#',
      '//a@x/api/docs-json',
      '/api/v1/health?#',
      'http://api.test//a@x/api/docs-json?#',
    ]) {
      for (const method of ['GET', 'HEAD', 'POST']) {
        const res = await rawRequest(port, target, { method });
        assert.equal(res.status, 400, `${method} ${target} → ${res.status}`);
        assert.ok(
          !res.body.includes('BACKEND'),
          `${method} ${target} backendga yetdi`,
        );
      }
    }
    // Oddiy query va % kodlangan belgilar avvalgidek o'tadi.
    for (const [target, expected] of [
      ['/api/v1/health?x=1', 'BACKEND GET /api/v1/health?x=1'],
      ['/api/v1/leads?q=%23', 'BACKEND GET /api/v1/leads?q=%23'],
    ]) {
      const res = await rawRequest(port, target);
      assert.equal(res.status, 200, `${target} → ${res.status}`);
      assert.equal(res.body, expected);
    }
  },
);

test('Caddyfile still proxies the API and media', { skip }, async (t) => {
  const port = await startStack(t);

  for (const [method, target, expected] of [
    ['GET', '/api/v1/health', 'BACKEND GET /api/v1/health'],
    ['POST', '/api/v1/leads', 'BACKEND POST /api/v1/leads'],
    ['OPTIONS', '/api/v1/leads', 'BACKEND OPTIONS /api/v1/leads'],
    ['GET', '/api/doc', 'BACKEND GET /api/doc'],
    ['GET', '/', 'BACKEND GET /'],
    ['GET', '/media/a.png', 'MINIO GET /a.png'],
  ]) {
    const res = await rawRequest(port, target, { method });
    assert.equal(res.status, 200, `${method} ${target} → ${res.status}`);
    assert.equal(res.body, expected);
  }
});
