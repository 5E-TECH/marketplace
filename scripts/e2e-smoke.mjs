import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';

const baseUrl = (process.env.E2E_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const scenarioFile = process.env.E2E_SCENARIO_FILE ?? 'deploy/e2e-smoke.json';
const variables = { ...process.env, BASE_URL: baseUrl, RUN_ID: String(Date.now()) };

function interpolate(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => {
      if (variables[key] === undefined) throw new Error(`${key} environment/capture qiymati yo'q`);
      return String(variables[key]);
    });
  }
  if (Array.isArray(value)) return value.map(interpolate);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item)]));
  }
  return value;
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

async function runStep(step, index) {
  const method = step.method ?? 'GET';
  const url = `${baseUrl}${interpolate(step.path)}`;
  const body = step.body === undefined ? undefined : JSON.stringify(interpolate(step.body));
  const headers = interpolate(step.headers ?? {});
  if (body) headers['content-type'] = 'application/json';
  if (step.bearer) headers.authorization = `Bearer ${interpolate(step.bearer)}`;
  if (step.hmacSecret) {
    headers['x-elchi-signature'] = createHmac('sha256', interpolate(step.hmacSecret)).update(body ?? '').digest('hex');
  }

  const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  const expected = step.expectStatus ?? [200, 201];
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(response.status)) {
    throw new Error(`${step.name}: HTTP ${response.status}, body=${text.slice(0, 500)}`);
  }
  for (const [key, path] of Object.entries(step.capture ?? {})) {
    const value = getPath(payload, path);
    if (value === undefined || value === null) throw new Error(`${step.name}: ${path} capture topilmadi`);
    variables[key] = String(value);
  }
  for (const assertion of step.assert ?? []) {
    const actual = getPath(payload, assertion.path);
    if (assertion.equals !== undefined && actual !== interpolate(assertion.equals)) {
      throw new Error(`${step.name}: ${assertion.path}=${JSON.stringify(actual)}, kutilgan=${JSON.stringify(interpolate(assertion.equals))}`);
    }
    if (assertion.nonEmpty && (!actual || actual.length === 0)) throw new Error(`${step.name}: ${assertion.path} bo'sh`);
  }
  console.log(`[${index + 1}] OK ${step.name}`);
}

const scenario = JSON.parse(await readFile(scenarioFile, 'utf8'));
for (const [index, step] of scenario.steps.entries()) await runStep(step, index);
console.log(`E2E smoke muvaffaqiyatli: ${scenario.steps.length} qadam`);
