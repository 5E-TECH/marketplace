import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const apiUrl =
  process.env.MONITOR_API_URL ??
  'http://localhost:3000/api/v1/health/readiness';
const rabbitUrl = process.env.RABBITMQ_MANAGEMENT_URL;
const intervalMs = positiveInt(process.env.MONITOR_INTERVAL_MS, 30_000);
const threshold = positiveInt(process.env.MONITOR_FAILURE_THRESHOLD, 3);
const webhookUrl = process.env.ALERT_WEBHOOK_URL;
const requiredQueues = [
  'echo_queue',
  'identity_queue',
  'catalog_queue',
  'inventory_queue',
  'checkout_queue',
  'payment_queue',
  'finance_queue',
  'integration_queue',
  'notification_queue',
  'search_queue',
  'file_queue',
];

let failures = 0;
let alertOpen = false;

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function fetchOk(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).origin}`);
  return response;
}

async function checkRabbitMq() {
  if (!rabbitUrl) return;
  const user = process.env.RABBITMQ_USER ?? 'guest';
  const password = process.env.RABBITMQ_PASSWORD ?? 'guest';
  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  const response = await fetchOk(`${rabbitUrl}/api/queues/%2F`, {
    headers: { authorization: `Basic ${auth}` },
  });
  const queues = await response.json();
  const consumers = new Map(
    queues.map((queue) => [queue.name, queue.consumers]),
  );
  const down = requiredQueues.filter((name) => !consumers.get(name));
  if (down.length) throw new Error(`consumer yo'q: ${down.join(', ')}`);
}

async function notify(status, detail) {
  const payload = {
    service: 'elchi-marketplace',
    status,
    detail,
    timestamp: new Date().toISOString(),
  };
  console.log(
    JSON.stringify({
      level: status === 'resolved' ? 'info' : 'error',
      ...payload,
    }),
  );
  if (!webhookUrl) return;
  await fetchOk(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  console.log(
    JSON.stringify({
      level: 'info',
      status: 'alert_delivered',
      alertStatus: status,
      timestamp: payload.timestamp,
    }),
  );
}

export async function checkOnce() {
  await fetchOk(apiUrl);
  await checkRabbitMq();
}

export async function tick() {
  let healthError;
  try {
    await checkOnce();
  } catch (error) {
    healthError = error;
  }
  if (healthError) {
    failures += 1;
    const detail =
      healthError instanceof Error ? healthError.message : String(healthError);
    console.error(
      JSON.stringify({ level: 'error', status: 'unhealthy', failures, detail }),
    );
    if (failures >= threshold && !alertOpen) {
      try {
        await notify('firing', detail);
        // Mark delivered only after success, so a failed webhook is retried.
        alertOpen = true;
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            status: 'alert_failed',
            detail: String(error),
          }),
        );
      }
    }
    return;
  }
  failures = 0;
  if (alertOpen) {
    try {
      await notify('resolved', 'API va barcha RabbitMQ consumerlar tiklandi');
      alertOpen = false;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          status: 'alert_failed',
          detail: String(error),
        }),
      );
    }
  }
  console.log(
    JSON.stringify({
      level: 'info',
      status: 'healthy',
      timestamp: new Date().toISOString(),
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!webhookUrl) {
    console.error(
      JSON.stringify({
        level: 'warn',
        status: 'alert_unconfigured',
        detail: 'ALERT_WEBHOOK_URL yo‘q: faqat lokal log yoziladi',
      }),
    );
  }
  // Await each check to prevent overlapping requests and duplicate alerts.
  while (true) {
    await tick();
    await sleep(intervalMs);
  }
}
