import { readFile, writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const baseUrl = (
  process.env.E2E_BASE_URL ?? 'http://localhost:3000/api/v1'
).replace(/\/$/, '');
const scenarioFile = process.env.E2E_SCENARIO_FILE ?? 'deploy/e2e-smoke.json';
const variables = {
  ...process.env,
  BASE_URL: baseUrl,
  RUN_ID: String(Date.now()),
};

function interpolate(value) {
  if (typeof value === 'string') {
    const exact = /^\$\{([A-Z0-9_]+)\}$/.exec(value);
    if (exact && variables[exact[1]] !== undefined) return variables[exact[1]];
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => {
      if (variables[key] === undefined)
        throw new Error(`${key} environment/capture qiymati yo'q`);
      return String(variables[key]);
    });
  }
  if (Array.isArray(value)) return value.map(interpolate);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolate(item)]),
    );
  }
  return value;
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

async function runStep(step, index) {
  const method = step.method ?? 'GET';
  const url = `${baseUrl}${interpolate(step.path)}`;
  const body =
    step.body === undefined
      ? undefined
      : JSON.stringify(interpolate(step.body));
  const headers = interpolate(step.headers ?? {});
  if (body) headers['content-type'] = 'application/json';
  if (step.bearer) headers.authorization = `Bearer ${interpolate(step.bearer)}`;
  if (step.hmacSecret) {
    headers['x-elchi-signature'] = createHmac(
      'sha256',
      interpolate(step.hmacSecret),
    )
      .update(body ?? '')
      .digest('hex');
  }

  let response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const tokenKey = /^\$\{([A-Z0-9_]+)\}$/.exec(step.bearer ?? '')?.[1];
  const credentials = scenario.reauthenticate?.[tokenKey];
  if (response.status === 401 && method === 'GET' && credentials) {
    await response.text();
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(interpolate(credentials)),
      signal: AbortSignal.timeout(15_000),
    });
    if (![200, 201].includes(login.status))
      throw new Error('E2E qayta login muvaffaqiyatsiz');
    const payload = JSON.parse(await login.text());
    if (!payload.accessToken) throw new Error('E2E qayta login tokeni yo‘q');
    variables[tokenKey] = payload.accessToken;
    headers.authorization = `Bearer ${payload.accessToken}`;
    response = await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  }
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  const expected = step.expectStatus ?? [200, 201];
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(response.status)) {
    throw new Error(
      `${step.name}: HTTP ${response.status}, requestId=${response.headers.get('x-request-id') ?? 'unknown'}`,
    );
  }
  if (step.select) {
    const items = getPath(payload, step.select.path);
    if (!Array.isArray(items))
      throw new Error(`${step.name}: selection ro‘yxati yo‘q`);
    payload = items.find((item) =>
      Object.entries(step.select.match).every(
        ([path, expected]) => getPath(item, path) === interpolate(expected),
      ),
    );
    if (!payload)
      throw new Error(`${step.name}: shu testga tegishli yozuv hali yo‘q`);
  }
  for (const assertion of step.assert ?? []) {
    const actual = getPath(payload, assertion.path);
    if (
      assertion.equals !== undefined &&
      actual !== interpolate(assertion.equals)
    ) {
      throw new Error(
        `${step.name}: ${assertion.path}=${JSON.stringify(actual)}, kutilgan=${JSON.stringify(interpolate(assertion.equals))}`,
      );
    }
    if (assertion.nonEmpty && (!actual || actual.length === 0))
      throw new Error(`${step.name}: ${assertion.path} bo'sh`);
  }
  for (const [key, path] of Object.entries(step.capture ?? {})) {
    const value = getPath(payload, path);
    if (value === undefined || value === null)
      throw new Error(`${step.name}: ${path} capture topilmadi`);
    variables[key] = value;
  }
  console.log(`[${index + 1}] OK ${step.name}`);
  if (step.message) console.log(interpolate(step.message));
}

const scenario = JSON.parse(await readFile(scenarioFile, 'utf8'));
for (const key of scenario.requiredEnv ?? []) {
  if (!process.env[key]?.trim())
    throw new Error(`${key} environment qiymati yo'q`);
}
const evidence = {
  scenario: scenarioFile,
  baseUrl,
  startedAt: new Date().toISOString(),
  steps: [],
};
try {
  for (const [index, step] of scenario.steps.entries()) {
    if (step.wait && (step.method ?? 'GET') !== 'GET')
      throw new Error('Faqat GET qadamni qayta kutish mumkin');
    const attempts = step.wait?.attempts ?? 1;
    const intervalMs = step.wait?.intervalMs ?? 1000;
    if (
      !Number.isInteger(attempts) ||
      attempts < 1 ||
      !Number.isInteger(intervalMs) ||
      intervalMs < 1
    )
      throw new Error('wait sozlamasi noto‘g‘ri');
    for (let attempt = 1; ; attempt++) {
      try {
        await runStep(step, index);
        break;
      } catch (error) {
        if (attempt >= attempts) throw error;
        if (attempt === 1)
          console.log(`WAIT ${step.name}: tashqi amal/natija kutilmoqda`);
        await sleep(intervalMs);
      }
    }
    evidence.steps.push({
      name: step.name,
      status: 'passed',
      at: new Date().toISOString(),
    });
  }
  evidence.status = 'passed';
  console.log(`E2E smoke muvaffaqiyatli: ${scenario.steps.length} qadam`);
} catch (error) {
  evidence.status = 'failed';
  evidence.steps.push({
    name: scenario.steps[evidence.steps.length]?.name,
    status: 'failed',
  });
  throw error;
} finally {
  evidence.finishedAt = new Date().toISOString();
  evidence.ids = Object.fromEntries(
    (scenario.evidenceIds ?? []).map((key) => [key, variables[key]]),
  );
  if (process.env.E2E_REPORT_FILE)
    await writeFile(
      process.env.E2E_REPORT_FILE,
      JSON.stringify(evidence, null, 2),
      { mode: 0o600 },
    );
}
